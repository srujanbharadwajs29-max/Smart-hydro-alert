import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import mqtt, { type MqttClient } from 'mqtt';
import type {
  MqttQoS,
  VirtualDevice,
  WaterScenario,
  WaterThresholds,
} from '../src/types/hydro.ts';
import type { HydroDatabase } from './database.ts';
import type { HydroMqttBroker } from './mqttBroker.ts';
import { generateScenarioReading } from './waterIntelligence.ts';

interface DefaultDeviceSeed {
  id: string;
  name: string;
  location: string;
  zone: string;
  scenario: WaterScenario;
  qos: MqttQoS;
  publishIntervalMs: number;
}

const DEFAULT_DEVICES: DefaultDeviceSeed[] = [
  {
    id: 'device00',
    name: 'Main Tank Device',
    location: 'Rooftop Reservoir · Main Tank',
    zone: 'main-tank',
    scenario: 'NORMAL_USAGE',
    qos: 1,
    publishIntervalMs: 2500,
  },
  {
    id: 'device01',
    name: 'Floor 1 Device',
    location: 'Building 1 · Floor 1 Utility Wing',
    zone: 'floor1',
    scenario: 'NORMAL_IDLE',
    qos: 1,
    publishIntervalMs: 2500,
  },
  {
    id: 'device02',
    name: 'Floor 2 Device',
    location: 'Building 1 · Floor 2 Restroom Block',
    zone: 'floor2',
    scenario: 'NORMAL_USAGE',
    qos: 1,
    publishIntervalMs: 3000,
  },
  {
    id: 'device03',
    name: 'Floor 3 Device',
    location: 'Building 1 · Floor 3 Lab Supply',
    zone: 'floor3',
    scenario: 'NORMAL_IDLE',
    qos: 1,
    publishIntervalMs: 3000,
  },
  {
    id: 'device04',
    name: 'Floor 4 Device',
    location: 'Building 1 · Floor 4 Mechanical Shaft',
    zone: 'floor4',
    scenario: 'NORMAL_IDLE',
    qos: 1,
    publishIntervalMs: 3500,
  },
];

interface ManagedDevice {
  state: VirtualDevice;
  client: MqttClient | null;
  timer: NodeJS.Timeout | null;
  manualDisconnect: boolean;
  wasEverConnected: boolean;
}

export interface BrokerAckEvent {
  deviceId: string;
  messageId: string;
  topic: string;
  qos: MqttQoS;
  brokerAckMs: number;
}

export class VirtualDeviceManager extends EventEmitter {
  private devices = new Map<string, ManagedDevice>();
  private broker: HydroMqttBroker;
  private db: HydroDatabase;
  private getThresholds: () => WaterThresholds;

  constructor(
    broker: HydroMqttBroker,
    db: HydroDatabase,
    getThresholds: () => WaterThresholds
  ) {
    super();
    this.broker = broker;
    this.db = db;
    this.getThresholds = getThresholds;
  }

  public async initializeDefaults(autoStart = true): Promise<void> {
    const persisted = this.db.listPersistedDevices();
    const seeds =
      persisted.length > 0
        ? persisted.map((p) => ({
            id: p.id,
            name: p.name,
            location: p.location,
            zone: p.zone,
            scenario: p.scenario,
            qos: p.qos,
            publishIntervalMs: p.publishIntervalMs,
            totalConsumptionLiters: p.totalConsumptionLiters,
            estimatedWastageLiters: p.estimatedWastageLiters,
          }))
        : DEFAULT_DEVICES.map((d) => ({
            ...d,
            totalConsumptionLiters: 0,
            estimatedWastageLiters: 0,
          }));

    for (const seed of seeds) {
      const managed = this.buildManagedDevice(seed);
      this.devices.set(seed.id, managed);
      this.db.upsertDevice(managed.state);
    }

    if (autoStart) {
      for (const id of this.devices.keys()) {
        await this.startDevice(id);
      }
    }
  }

  private buildManagedDevice(input: {
    id: string;
    name: string;
    location: string;
    zone: string;
    scenario?: WaterScenario;
    qos?: MqttQoS;
    publishIntervalMs?: number;
    totalConsumptionLiters?: number;
    estimatedWastageLiters?: number;
  }): ManagedDevice {
    const zoneSlug = input.zone.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'floor1';
    const topicBase = `hydro/building1/${zoneSlug}/${input.id}`;
    const thresholds = this.getThresholds();

    const state: VirtualDevice = {
      id: input.id,
      name: input.name,
      location: input.location,
      zone: zoneSlug,
      clientId: `hydro-virt-${input.id}`,
      topicBase,
      sensorTopic: `${topicBase}/sensor`,
      statusTopic: `${topicBase}/status`,
      alertTopic: `${topicBase}/alert`,
      flowRate: 0,
      presenceDetected: false,
      waterDetected: false,
      sensorState: 'NORMAL',
      totalConsumptionLiters: input.totalConsumptionLiters ?? 0,
      estimatedWastageLiters: input.estimatedWastageLiters ?? 0,
      connectionStatus: 'STOPPED',
      isRunning: false,
      publishingPaused: false,
      publishIntervalMs: input.publishIntervalMs ?? thresholds.defaultPublishIntervalMs,
      qos: input.qos ?? 1,
      simulatedDelayMs: 0,
      simulatedPacketLossPct: 0,
      scenario: input.scenario ?? 'NORMAL_IDLE',
      lastCommunicationAt: null,
      lastPublishAt: null,
      connectedAt: null,
      disconnectedAt: null,
      reconnectCount: 0,
      messagesPublished: 0,
      messagesAcknowledged: 0,
      messagesDropped: 0,
      unattendedFlowSeconds: 0,
      lastBrokerAckMs: null,
      lastBackendReceiptMs: null,
      softwareGenerated: true,
    };

    return {
      state,
      client: null,
      timer: null,
      manualDisconnect: false,
      wasEverConnected: false,
    };
  }

  public listDevices(): VirtualDevice[] {
    return Array.from(this.devices.values()).map((m) => ({ ...m.state }));
  }

  public getDevice(id: string): VirtualDevice | undefined {
    const managed = this.devices.get(id);
    return managed ? { ...managed.state } : undefined;
  }

  public getDeviceByClientId(clientId: string): VirtualDevice | undefined {
    for (const managed of this.devices.values()) {
      if (managed.state.clientId === clientId) return { ...managed.state };
    }
    return undefined;
  }

  public async addDevice(input: {
    name: string;
    location: string;
    zone?: string;
    qos?: MqttQoS;
    publishIntervalMs?: number;
    scenario?: WaterScenario;
    autoStart?: boolean;
  }): Promise<VirtualDevice> {
    const maxDevices = this.getThresholds().maxDevices;
    if (this.devices.size >= maxDevices) {
      throw new Error(`Maximum virtual device limit reached (${maxDevices})`);
    }

    let nextIndex = this.devices.size + 1;
    let id = `device${String(nextIndex).padStart(2, '0')}`;
    while (this.devices.has(id)) {
      nextIndex += 1;
      id = `device${String(nextIndex).padStart(2, '0')}`;
    }

    const zone =
      input.zone?.trim() ||
      input.location
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20) ||
      `zone${nextIndex}`;

    const managed = this.buildManagedDevice({
      id,
      name: input.name.trim(),
      location: input.location.trim(),
      zone,
      qos: input.qos ?? 1,
      publishIntervalMs: input.publishIntervalMs ?? this.getThresholds().defaultPublishIntervalMs,
      scenario: input.scenario ?? 'NORMAL_IDLE',
    });

    this.devices.set(id, managed);
    this.db.upsertDevice(managed.state);
    this.emit('deviceUpdated', { ...managed.state });

    if (input.autoStart !== false) {
      await this.startDevice(id);
    }

    return { ...managed.state };
  }

  public async removeDevice(id: string): Promise<void> {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);

    await this.stopDevice(id);
    this.devices.delete(id);
    this.db.deleteDevice(id);
    this.emit('devicesChanged', this.listDevices());
  }

  public async startDevice(id: string): Promise<VirtualDevice> {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);

    if (managed.client && managed.state.isRunning) {
      managed.state.publishingPaused = false;
      this.schedulePublishLoop(managed);
      this.emit('deviceUpdated', { ...managed.state });
      return { ...managed.state };
    }

    this.clearTimer(managed);
    if (managed.client) {
      managed.client.removeAllListeners();
      managed.client.end(true);
      managed.client = null;
    }

    managed.manualDisconnect = false;
    managed.state.isRunning = true;
    managed.state.publishingPaused = false;
    managed.state.connectionStatus = 'RECONNECTING';

    const auth = this.broker.getAuthCredentials();
    const lwtPayload = JSON.stringify({
      deviceId: managed.state.id,
      clientId: managed.state.clientId,
      status: 'OFFLINE',
      reason: 'LWT_UNEXPECTED_DISCONNECT',
      timestamp: new Date().toISOString(),
    });

    const client = mqtt.connect(this.broker.getBrokerUrl(), {
      clientId: managed.state.clientId,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 1800,
      keepalive: 10,
      username: auth.username,
      password: auth.password,
      will: {
        topic: managed.state.statusTopic,
        payload: Buffer.from(lwtPayload, 'utf8'),
        qos: 1,
        retain: true,
      },
    });

    managed.client = client;

    client.on('connect', () => {
      const nowIso = new Date().toISOString();
      const wasDisconnected = managed.wasEverConnected && managed.state.disconnectedAt !== null;
      const downtimeMs =
        wasDisconnected && managed.state.disconnectedAt
          ? Math.max(0, Date.now() - new Date(managed.state.disconnectedAt).getTime())
          : null;

      managed.state.connectionStatus = managed.state.publishingPaused ? 'SILENT' : 'CONNECTED';
      managed.state.connectedAt = nowIso;
      managed.state.lastCommunicationAt = nowIso;

      if (wasDisconnected) {
        managed.state.reconnectCount += 1;
        this.emit('deviceReconnected', {
          device: { ...managed.state },
          recoveredAt: nowIso,
          failureAt: managed.state.disconnectedAt,
          downtimeMs,
        });
      }
      managed.state.disconnectedAt = null;
      managed.wasEverConnected = true;

      const onlinePayload = JSON.stringify({
        deviceId: managed.state.id,
        clientId: managed.state.clientId,
        status: 'ONLINE',
        reason: wasDisconnected ? 'RECONNECTED' : 'CONNECTED',
        timestamp: nowIso,
      });
      client.publish(managed.state.statusTopic, onlinePayload, { qos: 1, retain: true });

      this.schedulePublishLoop(managed);
      this.emit('deviceUpdated', { ...managed.state });

      // Publish an immediate sample so telemetry populates without waiting a full cycle
      if (!managed.state.publishingPaused) {
        this.publishSensorReading(managed);
      }
    });

    client.on('reconnect', () => {
      if (managed.manualDisconnect) return;
      managed.state.connectionStatus = 'RECONNECTING';
      if (!managed.state.disconnectedAt) {
        managed.state.disconnectedAt = new Date().toISOString();
      }
      this.emit('deviceUpdated', { ...managed.state });
    });

    client.on('close', () => {
      this.clearTimer(managed);
      if (managed.manualDisconnect) return;
      const nowIso = new Date().toISOString();
      const alreadyOffline = managed.state.connectionStatus === 'DISCONNECTED';
      managed.state.connectionStatus = managed.state.isRunning ? 'RECONNECTING' : 'DISCONNECTED';
      if (!managed.state.disconnectedAt) {
        managed.state.disconnectedAt = nowIso;
      }
      if (!alreadyOffline) {
        this.emit('deviceDisconnected', {
          device: { ...managed.state },
          failureAt: managed.state.disconnectedAt,
          abrupt: false,
        });
      }
      this.emit('deviceUpdated', { ...managed.state });
    });

    client.on('error', () => {
      // Expected during simulated broker interruption; reconnect handler manages recovery
    });

    this.emit('deviceUpdated', { ...managed.state });
    return { ...managed.state };
  }

  public async stopDevice(id: string): Promise<VirtualDevice> {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);

    managed.manualDisconnect = true;
    this.clearTimer(managed);
    managed.state.isRunning = false;
    managed.state.publishingPaused = false;
    managed.state.connectionStatus = 'STOPPED';
    managed.state.disconnectedAt = new Date().toISOString();

    if (managed.client) {
      const client = managed.client;
      managed.client = null;
      if (client.connected) {
        const stopPayload = JSON.stringify({
          deviceId: managed.state.id,
          clientId: managed.state.clientId,
          status: 'STOPPED',
          reason: 'GRACEFUL_STOP',
          timestamp: new Date().toISOString(),
        });
        await new Promise<void>((resolve) => {
          client.publish(managed.state.statusTopic, stopPayload, { qos: 1, retain: true }, () => {
            client.end(false, {}, () => resolve());
          });
        });
      } else {
        client.end(true);
      }
    }

    this.emit('deviceUpdated', { ...managed.state });
    return { ...managed.state };
  }

  /**
   * Simulates a real network disconnection.
   * When abrupt=true, destroys the underlying TCP socket without MQTT DISCONNECT so the broker fires LWT!
   */
  public async disconnectDevice(id: string, abrupt = true): Promise<VirtualDevice> {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);

    managed.manualDisconnect = true;
    this.clearTimer(managed);
    managed.state.isRunning = false;
    managed.state.connectionStatus = 'DISCONNECTED';
    const failureAt = new Date().toISOString();
    managed.state.disconnectedAt = failureAt;

    if (managed.client) {
      const client = managed.client;
      managed.client = null;
      client.options.reconnectPeriod = 0;

      if (abrupt) {
        // Destroy raw TCP stream directly so no MQTT DISCONNECT packet is sent -> triggers real MQTT LWT on broker
        const stream = (client as unknown as { stream?: { destroy?: () => void } }).stream;
        if (stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
        client.end(true);
      } else {
        await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
      }
    }

    this.emit('deviceDisconnected', {
      device: { ...managed.state },
      failureAt,
      abrupt,
    });
    this.emit('deviceUpdated', { ...managed.state });
    return { ...managed.state };
  }

  public async restartDevice(id: string): Promise<VirtualDevice> {
    await this.stopDevice(id);
    return this.startDevice(id);
  }

  public async startAll(): Promise<VirtualDevice[]> {
    for (const id of this.devices.keys()) {
      await this.startDevice(id);
    }
    return this.listDevices();
  }

  public async stopAll(): Promise<VirtualDevice[]> {
    for (const id of this.devices.keys()) {
      await this.stopDevice(id);
    }
    return this.listDevices();
  }

  public resetDevice(id: string): VirtualDevice {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);

    managed.state.scenario = 'NORMAL_IDLE';
    managed.state.flowRate = 0;
    managed.state.presenceDetected = false;
    managed.state.waterDetected = false;
    managed.state.sensorState = 'NORMAL';
    managed.state.unattendedFlowSeconds = 0;
    managed.state.totalConsumptionLiters = 0;
    managed.state.estimatedWastageLiters = 0;
    managed.state.simulatedDelayMs = 0;
    managed.state.simulatedPacketLossPct = 0;
    managed.state.publishingPaused = false;

    this.db.upsertDevice(managed.state);
    this.emit('deviceUpdated', { ...managed.state });
    if (managed.client?.connected) {
      this.publishSensorReading(managed);
    }
    return { ...managed.state };
  }

  public updateDeviceConfig(
    id: string,
    updates: Partial<{
      publishIntervalMs: number;
      qos: MqttQoS;
      scenario: WaterScenario;
      publishingPaused: boolean;
      simulatedDelayMs: number;
      simulatedPacketLossPct: number;
    }>
  ): VirtualDevice {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);

    if (updates.publishIntervalMs !== undefined) {
      managed.state.publishIntervalMs = Math.max(500, Math.min(30000, Math.round(updates.publishIntervalMs)));
      if (managed.client?.connected) {
        this.schedulePublishLoop(managed);
      }
    }
    if (updates.qos !== undefined && [0, 1, 2].includes(updates.qos)) {
      managed.state.qos = updates.qos;
    }
    if (updates.scenario !== undefined) {
      managed.state.scenario = updates.scenario;
      if (updates.scenario === 'NORMAL_IDLE' || updates.scenario === 'NORMAL_USAGE') {
        managed.state.unattendedFlowSeconds = 0;
      }
    }
    if (updates.publishingPaused !== undefined) {
      managed.state.publishingPaused = updates.publishingPaused;
      if (!updates.publishingPaused && managed.client?.connected) {
        managed.state.connectionStatus = 'CONNECTED';
        this.publishSensorReading(managed);
      }
    }
    if (updates.simulatedDelayMs !== undefined) {
      managed.state.simulatedDelayMs = Math.max(0, Math.min(10000, Math.round(updates.simulatedDelayMs)));
    }
    if (updates.simulatedPacketLossPct !== undefined) {
      managed.state.simulatedPacketLossPct = Math.max(0, Math.min(100, Math.round(updates.simulatedPacketLossPct)));
    }

    this.db.upsertDevice(managed.state);
    this.emit('deviceUpdated', { ...managed.state });
    return { ...managed.state };
  }

  public triggerScenario(id: string, scenario: WaterScenario): VirtualDevice {
    const managed = this.devices.get(id);
    if (!managed) throw new Error(`Device not found: ${id}`);
    managed.state.scenario = scenario;
    if (scenario === 'NORMAL_IDLE' || scenario === 'NORMAL_USAGE') {
      managed.state.unattendedFlowSeconds = 0;
    }
    this.db.upsertDevice(managed.state);

    if (managed.client?.connected && !managed.state.publishingPaused) {
      this.publishSensorReading(managed);
    }
    this.emit('deviceUpdated', { ...managed.state });
    return { ...managed.state };
  }

  public markDeviceSilent(id: string): VirtualDevice | null {
    const managed = this.devices.get(id);
    if (!managed) return null;
    if (managed.state.connectionStatus === 'CONNECTED') {
      managed.state.connectionStatus = 'SILENT';
      this.emit('deviceUpdated', { ...managed.state });
      return { ...managed.state };
    }
    return null;
  }

  public applyProcessedReading(
    deviceId: string,
    patch: {
      flowRate: number;
      presenceDetected: boolean;
      waterDetected: boolean;
      sensorState: VirtualDevice['sensorState'];
      unattendedFlowSeconds: number;
      consumptionDeltaLiters: number;
      wastageDeltaLiters: number;
      receivedAt: string;
      backendReceiptMs: number;
    }
  ): VirtualDevice | null {
    const managed = this.devices.get(deviceId);
    if (!managed) return null;

    managed.state.flowRate = patch.flowRate;
    managed.state.presenceDetected = patch.presenceDetected;
    managed.state.waterDetected = patch.waterDetected;
    managed.state.sensorState = patch.sensorState;
    managed.state.unattendedFlowSeconds = patch.unattendedFlowSeconds;
    managed.state.totalConsumptionLiters = Number(
      (managed.state.totalConsumptionLiters + patch.consumptionDeltaLiters).toFixed(3)
    );
    managed.state.estimatedWastageLiters = Number(
      (managed.state.estimatedWastageLiters + patch.wastageDeltaLiters).toFixed(3)
    );
    managed.state.lastCommunicationAt = patch.receivedAt;
    managed.state.lastBackendReceiptMs = patch.backendReceiptMs;
    if (managed.state.connectionStatus === 'SILENT' && managed.client?.connected) {
      managed.state.connectionStatus = 'CONNECTED';
    }

    this.db.upsertDevice(managed.state);
    return { ...managed.state };
  }

  private clearTimer(managed: ManagedDevice): void {
    if (managed.timer) {
      clearInterval(managed.timer);
      managed.timer = null;
    }
  }

  private schedulePublishLoop(managed: ManagedDevice): void {
    this.clearTimer(managed);
    managed.timer = setInterval(() => {
      this.publishSensorReading(managed);
    }, managed.state.publishIntervalMs);
  }

  public publishSensorReading(managed: ManagedDevice): void {
    if (!managed.client || !managed.client.connected || managed.state.publishingPaused) {
      return;
    }

    // Simulated transport-layer packet loss (clearly counted and reported as simulated client drop)
    if (
      managed.state.simulatedPacketLossPct > 0 &&
      Math.random() * 100 < managed.state.simulatedPacketLossPct
    ) {
      managed.state.messagesDropped += 1;
      this.emit('packetDroppedSimulated', {
        deviceId: managed.state.id,
        topic: managed.state.sensorTopic,
      });
      this.emit('deviceUpdated', { ...managed.state });
      return;
    }

    const doPublish = () => {
      if (!managed.client || !managed.client.connected || managed.state.publishingPaused) return;

      const thresholds = this.getThresholds();
      const sample = generateScenarioReading(managed.state.scenario, thresholds);

      let unattendedSeconds = managed.state.unattendedFlowSeconds;
      if (sample.forceUnattendedSeconds !== undefined) {
        unattendedSeconds = Math.max(unattendedSeconds, sample.forceUnattendedSeconds);
      } else if (sample.flowRate >= thresholds.flowActiveThresholdLpm && !sample.presenceDetected) {
        unattendedSeconds += managed.state.publishIntervalMs / 1000;
      } else {
        unattendedSeconds = 0;
      }

      const messageId = `msg-${managed.state.id}-${crypto.randomBytes(3).toString('hex')}`;
      const publishedAtIso = new Date().toISOString();
      const hrPublishNs = process.hrtime.bigint();
      const qos = managed.state.qos;

      const payload = JSON.stringify({
        messageId,
        deviceId: managed.state.id,
        deviceName: managed.state.name,
        location: managed.state.location,
        flowRate: sample.flowRate,
        presenceDetected: sample.presenceDetected,
        waterDetected: sample.waterDetected,
        unattendedFlowSeconds: Number(unattendedSeconds.toFixed(1)),
        intervalMs: managed.state.publishIntervalMs,
        qos,
        publishedAtIso,
        hrPublishNs: hrPublishNs.toString(),
        softwareGenerated: true,
      });

      managed.state.messagesPublished += 1;
      managed.state.lastPublishAt = publishedAtIso;

      managed.client.publish(managed.state.sensorTopic, payload, { qos, retain: false }, (err) => {
        if (err) return;
        const ackMs = Number((Number(process.hrtime.bigint() - hrPublishNs) / 1e6).toFixed(3));
        managed.state.messagesAcknowledged += 1;
        managed.state.lastBrokerAckMs = ackMs;

        const ackEvent: BrokerAckEvent = {
          deviceId: managed.state.id,
          messageId,
          topic: managed.state.sensorTopic,
          qos,
          brokerAckMs: ackMs,
        };
        this.emit('brokerAck', ackEvent);
      });
    };

    if (managed.state.simulatedDelayMs > 0) {
      setTimeout(doPublish, managed.state.simulatedDelayMs);
    } else {
      doPublish();
    }
  }

  public async restoreAllFaults(): Promise<VirtualDevice[]> {
    for (const [id, managed] of this.devices.entries()) {
      managed.state.simulatedDelayMs = 0;
      managed.state.simulatedPacketLossPct = 0;
      managed.state.publishingPaused = false;
      if (!managed.client || !managed.client.connected) {
        await this.startDevice(id);
      } else {
        managed.state.connectionStatus = 'CONNECTED';
        this.schedulePublishLoop(managed);
        this.publishSensorReading(managed);
      }
      this.db.upsertDevice(managed.state);
    }
    return this.listDevices();
  }

  public async shutdown(): Promise<void> {
    for (const id of this.devices.keys()) {
      await this.stopDevice(id);
    }
  }
}
