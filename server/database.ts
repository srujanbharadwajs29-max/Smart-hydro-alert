import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  MqttEventRecord,
  MqttQoS,
  NetworkFailureEvent,
  QosExperimentResult,
  SensorReadingRecord,
  VirtualDevice,
  WaterAlertRecord,
  WaterScenario,
  WaterState,
  WaterThresholds,
} from '../src/types/hydro.ts';

export const DEFAULT_THRESHOLDS: WaterThresholds = {
  flowActiveThresholdLpm: 0.5,
  warningUnattendedSec: 12,
  alertWastageSec: 25,
  criticalFlowThresholdLpm: 18.0,
  heartbeatTimeoutSec: 12,
  maxDevices: 20,
  defaultPublishIntervalMs: 2500,
};

const RETENTION_LIMITS = {
  sensor_readings: 1500,
  mqtt_events: 1500,
  water_alerts: 500,
  network_events: 500,
  qos_experiments: 100,
};

export interface PersistedDeviceRow {
  id: string;
  name: string;
  location: string;
  zone: string;
  publishIntervalMs: number;
  qos: MqttQoS;
  scenario: WaterScenario;
  totalConsumptionLiters: number;
  estimatedWastageLiters: number;
}

export class HydroDatabase {
  private db: DatabaseSync;
  public readonly dbPath: string;
  private writeCounter = 0;

  constructor(customPath?: string) {
    const rawPath = customPath || process.env.DB_PATH || 'data/hydro_network.db';
    this.dbPath = rawPath === ':memory:' ? ':memory:' : path.resolve(process.cwd(), rawPath);

    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        zone TEXT NOT NULL,
        publish_interval_ms INTEGER NOT NULL DEFAULT 2500,
        qos INTEGER NOT NULL DEFAULT 1,
        scenario TEXT NOT NULL DEFAULT 'NORMAL_IDLE',
        total_consumption_liters REAL NOT NULL DEFAULT 0,
        estimated_wastage_liters REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        location TEXT NOT NULL,
        topic TEXT NOT NULL,
        qos INTEGER NOT NULL,
        flow_rate REAL NOT NULL,
        presence_detected INTEGER NOT NULL,
        water_detected INTEGER NOT NULL,
        sensor_state TEXT NOT NULL,
        consumption_delta_liters REAL NOT NULL,
        wastage_delta_liters REAL NOT NULL,
        published_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        broker_ack_ms REAL,
        backend_receipt_ms REAL NOT NULL,
        backend_process_ms REAL NOT NULL,
        software_generated INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_readings_device ON sensor_readings(device_id, id DESC);

      CREATE TABLE IF NOT EXISTS water_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        location TEXT NOT NULL,
        severity TEXT NOT NULL,
        previous_state TEXT NOT NULL,
        flow_rate REAL NOT NULL,
        water_detected INTEGER NOT NULL,
        presence_detected INTEGER NOT NULL,
        estimated_wastage_liters REAL NOT NULL,
        message TEXT NOT NULL,
        topic TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        acknowledged_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_created ON water_alerts(id DESC);

      CREATE TABLE IF NOT EXISTS mqtt_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        qos INTEGER NOT NULL,
        retain INTEGER NOT NULL,
        payload_size INTEGER NOT NULL,
        payload_preview TEXT NOT NULL,
        broker_ack_ms REAL,
        backend_receipt_ms REAL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mqtt_events_id ON mqtt_events(id DESC);

      CREATE TABLE IF NOT EXISTS network_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        detection_method TEXT NOT NULL,
        severity TEXT NOT NULL,
        details TEXT NOT NULL,
        failure_at TEXT,
        recovered_at TEXT,
        downtime_ms REAL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_network_events_id ON network_events(id DESC);

      CREATE TABLE IF NOT EXISTS qos_experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE,
        qos INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        published_count INTEGER NOT NULL,
        acknowledged_count INTEGER NOT NULL,
        received_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        duplicate_count INTEGER NOT NULL,
        avg_broker_ack_ms REAL NOT NULL,
        min_broker_ack_ms REAL NOT NULL,
        max_broker_ack_ms REAL NOT NULL,
        avg_delivery_ms REAL NOT NULL,
        min_delivery_ms REAL NOT NULL,
        max_delivery_ms REAL NOT NULL,
        packet_loss_pct REAL NOT NULL,
        simulated_delay_ms INTEGER NOT NULL,
        handshake_sequence TEXT NOT NULL,
        protocol_note TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private maybePrune(): void {
    this.writeCounter += 1;
    if (this.writeCounter % 50 !== 0) return;

    this.db
      .prepare(
        `DELETE FROM sensor_readings WHERE id NOT IN (SELECT id FROM sensor_readings ORDER BY id DESC LIMIT ?)`
      )
      .run(RETENTION_LIMITS.sensor_readings);
    this.db
      .prepare(
        `DELETE FROM mqtt_events WHERE id NOT IN (SELECT id FROM mqtt_events ORDER BY id DESC LIMIT ?)`
      )
      .run(RETENTION_LIMITS.mqtt_events);
    this.db
      .prepare(
        `DELETE FROM water_alerts WHERE id NOT IN (SELECT id FROM water_alerts ORDER BY id DESC LIMIT ?)`
      )
      .run(RETENTION_LIMITS.water_alerts);
    this.db
      .prepare(
        `DELETE FROM network_events WHERE id NOT IN (SELECT id FROM network_events ORDER BY id DESC LIMIT ?)`
      )
      .run(RETENTION_LIMITS.network_events);
  }

  public getThresholds(): WaterThresholds {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get('thresholds') as { value: string } | undefined;
    if (!row) {
      this.saveThresholds(DEFAULT_THRESHOLDS);
      return { ...DEFAULT_THRESHOLDS };
    }
    try {
      const parsed = JSON.parse(row.value) as Partial<WaterThresholds>;
      return { ...DEFAULT_THRESHOLDS, ...parsed };
    } catch {
      return { ...DEFAULT_THRESHOLDS };
    }
  }

  public saveThresholds(thresholds: WaterThresholds): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
      .run('thresholds', JSON.stringify(thresholds));
  }

  public listPersistedDevices(): PersistedDeviceRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, location, zone, publish_interval_ms, qos, scenario, total_consumption_liters, estimated_wastage_liters FROM devices ORDER BY created_at ASC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      location: String(r.location),
      zone: String(r.zone),
      publishIntervalMs: Number(r.publish_interval_ms),
      qos: Number(r.qos) as MqttQoS,
      scenario: String(r.scenario) as WaterScenario,
      totalConsumptionLiters: Number(r.total_consumption_liters),
      estimatedWastageLiters: Number(r.estimated_wastage_liters),
    }));
  }

  public upsertDevice(device: Pick<
    VirtualDevice,
    | 'id'
    | 'name'
    | 'location'
    | 'zone'
    | 'publishIntervalMs'
    | 'qos'
    | 'scenario'
    | 'totalConsumptionLiters'
    | 'estimatedWastageLiters'
  >): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, name, location, zone, publish_interval_ms, qos, scenario, total_consumption_liters, estimated_wastage_liters, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           location = excluded.location,
           zone = excluded.zone,
           publish_interval_ms = excluded.publish_interval_ms,
           qos = excluded.qos,
           scenario = excluded.scenario,
           total_consumption_liters = excluded.total_consumption_liters,
           estimated_wastage_liters = excluded.estimated_wastage_liters`
      )
      .run(
        device.id,
        device.name,
        device.location,
        device.zone,
        device.publishIntervalMs,
        device.qos,
        device.scenario,
        device.totalConsumptionLiters,
        device.estimatedWastageLiters,
        new Date().toISOString()
      );
  }

  public deleteDevice(id: string): void {
    this.db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
  }

  public insertReading(reading: Omit<SensorReadingRecord, 'id'>): SensorReadingRecord {
    const result = this.db
      .prepare(
        `INSERT INTO sensor_readings (
          message_id, device_id, device_name, location, topic, qos, flow_rate,
          presence_detected, water_detected, sensor_state, consumption_delta_liters,
          wastage_delta_liters, published_at, received_at, broker_ack_ms,
          backend_receipt_ms, backend_process_ms, software_generated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        reading.messageId,
        reading.deviceId,
        reading.deviceName,
        reading.location,
        reading.topic,
        reading.qos,
        reading.flowRate,
        reading.presenceDetected ? 1 : 0,
        reading.waterDetected ? 1 : 0,
        reading.sensorState,
        reading.consumptionDeltaLiters,
        reading.wastageDeltaLiters,
        reading.publishedAt,
        reading.receivedAt,
        reading.brokerAckMs,
        reading.backendReceiptMs,
        reading.backendProcessMs,
        reading.softwareGenerated ? 1 : 0
      );

    this.maybePrune();
    return {
      ...reading,
      id: Number(result.lastInsertRowid),
    };
  }

  public getRecentReadings(limit = 80, deviceId?: string): SensorReadingRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = (deviceId
      ? this.db
          .prepare(`SELECT * FROM sensor_readings WHERE device_id = ? ORDER BY id DESC LIMIT ?`)
          .all(deviceId, safeLimit)
      : this.db
          .prepare(`SELECT * FROM sensor_readings ORDER BY id DESC LIMIT ?`)
          .all(safeLimit)) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      messageId: String(r.message_id),
      deviceId: String(r.device_id),
      deviceName: String(r.device_name),
      location: String(r.location),
      topic: String(r.topic),
      qos: Number(r.qos) as MqttQoS,
      flowRate: Number(r.flow_rate),
      presenceDetected: Boolean(r.presence_detected),
      waterDetected: Boolean(r.water_detected),
      sensorState: String(r.sensor_state) as WaterState,
      consumptionDeltaLiters: Number(r.consumption_delta_liters),
      wastageDeltaLiters: Number(r.wastage_delta_liters),
      publishedAt: String(r.published_at),
      receivedAt: String(r.received_at),
      brokerAckMs: r.broker_ack_ms === null ? null : Number(r.broker_ack_ms),
      backendReceiptMs: Number(r.backend_receipt_ms),
      backendProcessMs: Number(r.backend_process_ms),
      softwareGenerated: Boolean(r.software_generated),
    }));
  }

  public insertAlert(alert: Omit<WaterAlertRecord, 'id'>): WaterAlertRecord {
    const result = this.db
      .prepare(
        `INSERT INTO water_alerts (
          device_id, device_name, location, severity, previous_state, flow_rate,
          water_detected, presence_detected, estimated_wastage_liters, message,
          topic, acknowledged, acknowledged_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        alert.deviceId,
        alert.deviceName,
        alert.location,
        alert.severity,
        alert.previousState,
        alert.flowRate,
        alert.waterDetected ? 1 : 0,
        alert.presenceDetected ? 1 : 0,
        alert.estimatedWastageLiters,
        alert.message,
        alert.topic,
        alert.acknowledged ? 1 : 0,
        alert.acknowledgedAt,
        alert.createdAt
      );

    this.maybePrune();
    return {
      ...alert,
      id: Number(result.lastInsertRowid),
    };
  }

  public getAlerts(limit = 100): WaterAlertRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(`SELECT * FROM water_alerts ORDER BY id DESC LIMIT ?`)
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      deviceId: String(r.device_id),
      deviceName: String(r.device_name),
      location: String(r.location),
      severity: String(r.severity) as WaterAlertRecord['severity'],
      previousState: String(r.previous_state) as WaterState,
      flowRate: Number(r.flow_rate),
      waterDetected: Boolean(r.water_detected),
      presenceDetected: Boolean(r.presence_detected),
      estimatedWastageLiters: Number(r.estimated_wastage_liters),
      message: String(r.message),
      topic: String(r.topic),
      acknowledged: Boolean(r.acknowledged),
      acknowledgedAt: r.acknowledged_at ? String(r.acknowledged_at) : null,
      createdAt: String(r.created_at),
    }));
  }

  public acknowledgeAlert(id: number): WaterAlertRecord | null {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE water_alerts SET acknowledged = 1, acknowledged_at = ? WHERE id = ?`)
      .run(now, id);
    const row = this.db
      .prepare(`SELECT * FROM water_alerts WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      deviceId: String(row.device_id),
      deviceName: String(row.device_name),
      location: String(row.location),
      severity: String(row.severity) as WaterAlertRecord['severity'],
      previousState: String(row.previous_state) as WaterState,
      flowRate: Number(row.flow_rate),
      waterDetected: Boolean(row.water_detected),
      presenceDetected: Boolean(row.presence_detected),
      estimatedWastageLiters: Number(row.estimated_wastage_liters),
      message: String(row.message),
      topic: String(row.topic),
      acknowledged: Boolean(row.acknowledged),
      acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
      createdAt: String(row.created_at),
    };
  }

  public insertMqttEvent(event: Omit<MqttEventRecord, 'id'>): MqttEventRecord {
    const result = this.db
      .prepare(
        `INSERT INTO mqtt_events (
          message_id, event_type, client_id, topic, qos, retain,
          payload_size, payload_preview, broker_ack_ms, backend_receipt_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.messageId,
        event.eventType,
        event.clientId,
        event.topic,
        event.qos,
        event.retain ? 1 : 0,
        event.payloadSize,
        event.payloadPreview,
        event.brokerAckMs,
        event.backendReceiptMs,
        event.createdAt
      );

    this.maybePrune();
    return {
      ...event,
      id: Number(result.lastInsertRowid),
    };
  }

  public getRecentMqttEvents(limit = 100): MqttEventRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(`SELECT * FROM mqtt_events ORDER BY id DESC LIMIT ?`)
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      messageId: String(r.message_id),
      eventType: String(r.event_type) as MqttEventRecord['eventType'],
      clientId: String(r.client_id),
      topic: String(r.topic),
      qos: Number(r.qos) as MqttQoS,
      retain: Boolean(r.retain),
      payloadSize: Number(r.payload_size),
      payloadPreview: String(r.payload_preview),
      brokerAckMs: r.broker_ack_ms === null ? null : Number(r.broker_ack_ms),
      backendReceiptMs: r.backend_receipt_ms === null ? null : Number(r.backend_receipt_ms),
      createdAt: String(r.created_at),
    }));
  }

  public insertNetworkEvent(event: Omit<NetworkFailureEvent, 'id'>): NetworkFailureEvent {
    const result = this.db
      .prepare(
        `INSERT INTO network_events (
          event_type, target_id, target_name, detection_method, severity,
          details, failure_at, recovered_at, downtime_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.eventType,
        event.targetId,
        event.targetName,
        event.detectionMethod,
        event.severity,
        event.details,
        event.failureAt,
        event.recoveredAt,
        event.downtimeMs,
        event.createdAt
      );

    this.maybePrune();
    return {
      ...event,
      id: Number(result.lastInsertRowid),
    };
  }

  public getRecentNetworkEvents(limit = 100): NetworkFailureEvent[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(`SELECT * FROM network_events ORDER BY id DESC LIMIT ?`)
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      eventType: String(r.event_type) as NetworkFailureEvent['eventType'],
      targetId: String(r.target_id),
      targetName: String(r.target_name),
      detectionMethod: String(r.detection_method) as NetworkFailureEvent['detectionMethod'],
      severity: String(r.severity) as NetworkFailureEvent['severity'],
      details: String(r.details),
      failureAt: r.failure_at ? String(r.failure_at) : null,
      recoveredAt: r.recovered_at ? String(r.recovered_at) : null,
      downtimeMs: r.downtime_ms === null ? null : Number(r.downtime_ms),
      createdAt: String(r.created_at),
    }));
  }

  public insertQosExperiment(exp: Omit<QosExperimentResult, 'id'>): QosExperimentResult {
    const result = this.db
      .prepare(
        `INSERT INTO qos_experiments (
          run_id, qos, message_count, published_count, acknowledged_count,
          received_count, failed_count, duplicate_count, avg_broker_ack_ms,
          min_broker_ack_ms, max_broker_ack_ms, avg_delivery_ms, min_delivery_ms,
          max_delivery_ms, packet_loss_pct, simulated_delay_ms, handshake_sequence,
          protocol_note, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        exp.runId,
        exp.qos,
        exp.messageCount,
        exp.publishedCount,
        exp.acknowledgedCount,
        exp.receivedCount,
        exp.failedCount,
        exp.duplicateCount,
        exp.avgBrokerAckMs,
        exp.minBrokerAckMs,
        exp.maxBrokerAckMs,
        exp.avgDeliveryMs,
        exp.minDeliveryMs,
        exp.maxDeliveryMs,
        exp.packetLossPct,
        exp.simulatedDelayMs,
        JSON.stringify(exp.handshakeSequence),
        exp.protocolNote,
        exp.startedAt,
        exp.completedAt
      );

    return {
      ...exp,
      id: Number(result.lastInsertRowid),
    };
  }

  public getQosExperiments(limit = 30): QosExperimentResult[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.db
      .prepare(`SELECT * FROM qos_experiments ORDER BY id DESC LIMIT ?`)
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      runId: String(r.run_id),
      qos: Number(r.qos) as MqttQoS,
      messageCount: Number(r.message_count),
      publishedCount: Number(r.published_count),
      acknowledgedCount: Number(r.acknowledged_count),
      receivedCount: Number(r.received_count),
      failedCount: Number(r.failed_count),
      duplicateCount: Number(r.duplicate_count),
      avgBrokerAckMs: Number(r.avg_broker_ack_ms),
      minBrokerAckMs: Number(r.min_broker_ack_ms),
      maxBrokerAckMs: Number(r.max_broker_ack_ms),
      avgDeliveryMs: Number(r.avg_delivery_ms),
      minDeliveryMs: Number(r.min_delivery_ms),
      maxDeliveryMs: Number(r.max_delivery_ms),
      packetLossPct: Number(r.packet_loss_pct),
      simulatedDelayMs: Number(r.simulated_delay_ms),
      handshakeSequence: JSON.parse(String(r.handshake_sequence)) as string[],
      protocolNote: String(r.protocol_note),
      startedAt: String(r.started_at),
      completedAt: String(r.completed_at),
    }));
  }

  public getCounts(): {
    devices: number;
    readings: number;
    alerts: number;
    mqttEvents: number;
    networkEvents: number;
    qosExperiments: number;
  } {
    const count = (table: string): number => {
      const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      return Number(row.c);
    };
    return {
      devices: count('devices'),
      readings: count('sensor_readings'),
      alerts: count('water_alerts'),
      mqttEvents: count('mqtt_events'),
      networkEvents: count('network_events'),
      qosExperiments: count('qos_experiments'),
    };
  }

  public clearTelemetryHistory(): void {
    this.db.exec(`
      DELETE FROM sensor_readings;
      DELETE FROM water_alerts;
      DELETE FROM mqtt_events;
      DELETE FROM network_events;
    `);
  }

  public close(): void {
    this.db.close();
  }
}
