import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import mqtt, { type MqttClient } from 'mqtt';
import type {
  AnalyticsPoint,
  MqttQoS,
  NetworkAnalyticsSummary,
  QosExperimentResult,
  SystemStatusSnapshot,
  TopicActivity,
  WaterState,
  WaterThresholds,
} from '../src/types/hydro.ts';
import type { HydroDatabase } from './database.ts';
import type { BrokerPublishInfo, HydroMqttBroker } from './mqttBroker.ts';
import type { BrokerAckEvent, VirtualDeviceManager } from './virtualDeviceManager.ts';
import { evaluateWaterState } from './waterIntelligence.ts';

interface LatencyTracker {
  samples: number[];
  min: number;
  max: number;
  sum: number;
  count: number;
}

function createLatencyTracker(): LatencyTracker {
  return { samples: [], min: Infinity, max: 0, sum: 0, count: 0 };
}

function recordLatency(tracker: LatencyTracker, ms: number): void {
  const clean = Math.max(0, Number(ms.toFixed(3)));
  tracker.samples.push(clean);
  if (tracker.samples.length > 200) tracker.samples.shift();
  tracker.count += 1;
  tracker.sum += clean;
  if (clean < tracker.min) tracker.min = clean;
  if (clean > tracker.max) tracker.max = clean;
}

function summarizeLatency(tracker: LatencyTracker): {
  avgMs: number;
  minMs: number;
  maxMs: number;
  samples: number;
} {
  if (tracker.count === 0) {
    return { avgMs: 0, minMs: 0, maxMs: 0, samples: 0 };
  }
  return {
    avgMs: Number((tracker.sum / tracker.count).toFixed(2)),
    minMs: Number((tracker.min === Infinity ? 0 : tracker.min).toFixed(2)),
    maxMs: Number(tracker.max.toFixed(2)),
    samples: tracker.count,
  };
}

export class HydroNetworkEngine extends EventEmitter {
  private broker: HydroMqttBroker;
  private db: HydroDatabase;
  private deviceManager: VirtualDeviceManager;
  private backendClient: MqttClient | null = null;
  private readonly backendClientId = 'hydro-backend-subscriber';
  private startedAtIso = new Date().toISOString();
  private startedAtMs = Date.now();
  private thresholds: WaterThresholds;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private analyticsTimer: NodeJS.Timeout | null = null;

  private topicMap = new Map<string, TopicActivity>();
  private recentBrokerAckByMsgId = new Map<string, number>();

  // Real event-driven counters
  private totalPublished = 0;
  private totalReceived = 0;
  private totalAcknowledged = 0;
  private successfulProcessing = 0;
  private failedProcessing = 0;
  private totalReconnections = 0;
  private totalDroppedSimulated = 0;

  // 1-second rolling bucket accumulators for real msg/s and throughput
  private windowMessages = 0;
  private windowBytes = 0;
  private windowBrokerAck: number[] = [];
  private windowReceipt: number[] = [];
  private windowProcess: number[] = [];
  private currentMsgPerSec = 0;
  private currentBytesPerSec = 0;

  private brokerAckLatency = createLatencyTracker();
  private backendReceiptLatency = createLatencyTracker();
  private backendProcessLatency = createLatencyTracker();
  private analyticsHistory: AnalyticsPoint[] = [];

  private getWsClientCount: () => number;

  constructor(
    broker: HydroMqttBroker,
    db: HydroDatabase,
    deviceManager: VirtualDeviceManager,
    getWsClientCount: () => number
  ) {
    super();
    this.broker = broker;
    this.db = db;
    this.deviceManager = deviceManager;
    this.getWsClientCount = getWsClientCount;
    this.thresholds = db.getThresholds();

    this.bindBrokerListeners();
    this.bindDeviceListeners();
  }

  public getThresholds(): WaterThresholds {
    return { ...this.thresholds };
  }

  public updateThresholds(patch: Partial<WaterThresholds>): WaterThresholds {
    const next: WaterThresholds = {
      flowActiveThresholdLpm:
        patch.flowActiveThresholdLpm !== undefined
          ? Math.max(0.1, Math.min(20, Number(patch.flowActiveThresholdLpm)))
          : this.thresholds.flowActiveThresholdLpm,
      warningUnattendedSec:
        patch.warningUnattendedSec !== undefined
          ? Math.max(3, Math.min(600, Math.round(Number(patch.warningUnattendedSec))))
          : this.thresholds.warningUnattendedSec,
      alertWastageSec:
        patch.alertWastageSec !== undefined
          ? Math.max(6, Math.min(1200, Math.round(Number(patch.alertWastageSec))))
          : this.thresholds.alertWastageSec,
      criticalFlowThresholdLpm:
        patch.criticalFlowThresholdLpm !== undefined
          ? Math.max(5, Math.min(100, Number(patch.criticalFlowThresholdLpm)))
          : this.thresholds.criticalFlowThresholdLpm,
      heartbeatTimeoutSec:
        patch.heartbeatTimeoutSec !== undefined
          ? Math.max(4, Math.min(120, Math.round(Number(patch.heartbeatTimeoutSec))))
          : this.thresholds.heartbeatTimeoutSec,
      maxDevices:
        patch.maxDevices !== undefined
          ? Math.max(5, Math.min(50, Math.round(Number(patch.maxDevices))))
          : this.thresholds.maxDevices,
      defaultPublishIntervalMs:
        patch.defaultPublishIntervalMs !== undefined
          ? Math.max(500, Math.min(30000, Math.round(Number(patch.defaultPublishIntervalMs))))
          : this.thresholds.defaultPublishIntervalMs,
    };

    if (next.alertWastageSec <= next.warningUnattendedSec) {
      next.alertWastageSec = next.warningUnattendedSec + 5;
    }

    this.thresholds = next;
    this.db.saveThresholds(next);
    this.emit('thresholdsUpdated', next);
    return { ...next };
  }

  public async start(): Promise<void> {
    await this.connectBackendSubscriber();
    this.startHeartbeatMonitor();
    this.startAnalyticsTicker();
  }

  private async connectBackendSubscriber(): Promise<void> {
    const auth = this.broker.getAuthCredentials();
    const client = mqtt.connect(this.broker.getBrokerUrl(), {
      clientId: this.backendClientId,
      clean: true,
      reconnectPeriod: 1500,
      keepalive: 15,
      username: auth.username,
      password: auth.password,
    });

    this.backendClient = client;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2500);
      client.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.on('connect', () => {
        client.subscribe('hydro/+/+/+/+', { qos: 2 }, (err) => {
          if (!err) {
            const event = this.db.insertMqttEvent({
              messageId: `sub-${Date.now()}`,
              eventType: 'SUBSCRIBE',
              clientId: this.backendClientId,
              topic: 'hydro/+/+/+/+',
              qos: 2,
              retain: false,
              payloadSize: 0,
              payloadPreview: 'Subscribed to hydro/+/+/+/+ (sensor, status, alert)',
              brokerAckMs: null,
              backendReceiptMs: null,
              createdAt: new Date().toISOString(),
            });
            this.emit('mqttEvent', event);
          }
        });
      });

      client.on('message', (topic, payloadBuf, packet) => {
        this.handleBackendMessage(topic, payloadBuf, (packet.qos ?? 0) as MqttQoS, Boolean(packet.retain));
      });

      client.on('error', () => {
        // Reconnects automatically after broker outage
      });
    });
  }

  private bindBrokerListeners(): void {
    this.broker.on('published', (info: BrokerPublishInfo) => {
      if (info.topic.startsWith('hydro/qos/')) return;
      this.totalPublished += 1;
      this.windowMessages += 1;
      this.windowBytes += info.payloadSize;

      const existing = this.topicMap.get(info.topic);
      const parts = info.topic.split('/');
      const deviceId = parts[3] || info.clientId;
      this.topicMap.set(info.topic, {
        topic: info.topic,
        messageCount: (existing?.messageCount ?? 0) + 1,
        lastQos: info.qos,
        lastPayloadSize: info.payloadSize,
        lastMessageAt: new Date().toISOString(),
        lastDeviceId: deviceId,
      });
    });

    this.broker.on('clientConnected', (clientId: string) => {
      const event = this.db.insertMqttEvent({
        messageId: `conn-${Date.now()}-${clientId.slice(-4)}`,
        eventType: 'CONNECT',
        clientId,
        topic: '$SYS/connect',
        qos: 0,
        retain: false,
        payloadSize: 0,
        payloadPreview: `Client ${clientId} completed MQTT CONNECT/CONNACK`,
        brokerAckMs: null,
        backendReceiptMs: null,
        createdAt: new Date().toISOString(),
      });
      this.emit('mqttEvent', event);
    });

    this.broker.on('clientDisconnected', (clientId: string) => {
      const event = this.db.insertMqttEvent({
        messageId: `disc-${Date.now()}-${clientId.slice(-4)}`,
        eventType: 'DISCONNECT',
        clientId,
        topic: '$SYS/disconnect',
        qos: 0,
        retain: false,
        payloadSize: 0,
        payloadPreview: `Client ${clientId} disconnected from MQTT broker`,
        brokerAckMs: null,
        backendReceiptMs: null,
        createdAt: new Date().toISOString(),
      });
      this.emit('mqttEvent', event);
    });

    this.broker.on('brokerInterrupted', ({ interruptedAt, durationMs }: { interruptedAt: string; durationMs?: number }) => {
      const netEvent = this.db.insertNetworkEvent({
        eventType: 'BROKER_INTERRUPTED',
        targetId: 'mqtt-broker',
        targetName: `MQTT Broker (:${this.broker.port})`,
        detectionMethod: 'BROKER_EVENT',
        severity: 'CRITICAL',
        details: durationMs
          ? `TCP MQTT broker stopped for simulated ${Math.round(durationMs / 1000)}s outage; active client sockets closed.`
          : 'TCP MQTT broker manually interrupted; all client sockets terminated.',
        failureAt: interruptedAt,
        recoveredAt: null,
        downtimeMs: null,
        createdAt: interruptedAt,
      });
      this.emit('networkEvent', netEvent);
    });

    this.broker.on('brokerRestored', ({ restoredAt, downtimeMs }: { restoredAt: string; downtimeMs: number }) => {
      const netEvent = this.db.insertNetworkEvent({
        eventType: 'BROKER_RESTORED',
        targetId: 'mqtt-broker',
        targetName: `MQTT Broker (:${this.broker.port})`,
        detectionMethod: 'BROKER_EVENT',
        severity: 'INFO',
        details: `TCP MQTT broker restored on port ${this.broker.port} after ${(downtimeMs / 1000).toFixed(1)}s downtime. Clients reconnecting.`,
        failureAt: null,
        recoveredAt: restoredAt,
        downtimeMs,
        createdAt: restoredAt,
      });
      this.emit('networkEvent', netEvent);
    });
  }

  private bindDeviceListeners(): void {
    this.deviceManager.on('brokerAck', (ack: BrokerAckEvent) => {
      this.totalAcknowledged += 1;
      recordLatency(this.brokerAckLatency, ack.brokerAckMs);
      this.windowBrokerAck.push(ack.brokerAckMs);
      this.recentBrokerAckByMsgId.set(ack.messageId, ack.brokerAckMs);
      if (this.recentBrokerAckByMsgId.size > 300) {
        const firstKey = this.recentBrokerAckByMsgId.keys().next().value;
        if (firstKey) this.recentBrokerAckByMsgId.delete(firstKey);
      }
    });

    this.deviceManager.on('packetDroppedSimulated', () => {
      this.totalDroppedSimulated += 1;
    });

    this.deviceManager.on('deviceUpdated', (device) => {
      this.emit('deviceUpdated', device);
    });

    this.deviceManager.on('devicesChanged', (devices) => {
      this.emit('devicesSync', devices);
    });

    this.deviceManager.on('deviceDisconnected', ({ device, failureAt, abrupt }) => {
      const netEvent = this.db.insertNetworkEvent({
        eventType: 'DEVICE_DISCONNECTED',
        targetId: device.id,
        targetName: device.name,
        detectionMethod: abrupt ? 'TCP_CLOSE' : 'USER_CONTROL',
        severity: 'WARNING',
        details: abrupt
          ? `Abrupt TCP socket drop on ${device.clientId} (no MQTT DISCONNECT sent — awaiting broker LWT).`
          : `Client ${device.clientId} disconnected from broker.`,
        failureAt,
        recoveredAt: null,
        downtimeMs: null,
        createdAt: new Date().toISOString(),
      });
      this.emit('networkEvent', netEvent);
    });

    this.deviceManager.on('deviceReconnected', ({ device, recoveredAt, failureAt, downtimeMs }) => {
      this.totalReconnections += 1;
      const netEvent = this.db.insertNetworkEvent({
        eventType: 'DEVICE_RECONNECTED',
        targetId: device.id,
        targetName: device.name,
        detectionMethod: 'BROKER_EVENT',
        severity: 'INFO',
        details: `Client ${device.clientId} reconnected and resumed MQTT publishing${
          downtimeMs !== null ? ` after ${(downtimeMs / 1000).toFixed(1)}s offline` : ''
        }.`,
        failureAt,
        recoveredAt,
        downtimeMs,
        createdAt: recoveredAt,
      });
      this.emit('networkEvent', netEvent);
    });
  }

  private handleBackendMessage(
    topic: string,
    payloadBuf: Buffer,
    qos: MqttQoS,
    retain: boolean
  ): void {
    const receivedHrNs = process.hrtime.bigint();
    const receivedAt = new Date().toISOString();
    const payloadText = payloadBuf.toString('utf8');
    const payloadSize = payloadBuf.byteLength;

    this.totalReceived += 1;

    try {
      const data = JSON.parse(payloadText) as Record<string, unknown>;
      const parts = topic.split('/');
      const channel = parts[4];

      if (channel === 'sensor') {
        const deviceId = String(data.deviceId || parts[3] || '');
        const device = this.deviceManager.getDevice(deviceId);
        if (!device) {
          this.failedProcessing += 1;
          return;
        }

        const flowRate = Number(data.flowRate);
        const presenceDetected = Boolean(data.presenceDetected);
        const waterDetected = Boolean(data.waterDetected);
        const unattendedFlowSeconds = Number(data.unattendedFlowSeconds ?? 0);
        const intervalMs = Math.max(250, Number(data.intervalMs ?? device.publishIntervalMs));
        const messageId = String(data.messageId || `msg-${Date.now()}`);
        const publishedAt = String(data.publishedAtIso || receivedAt);

        if (!Number.isFinite(flowRate) || flowRate < 0) {
          throw new Error('Invalid flowRate in sensor payload');
        }

        let backendReceiptMs = 0.25;
        if (typeof data.hrPublishNs === 'string') {
          try {
            const diffNs = Number(receivedHrNs - BigInt(data.hrPublishNs));
            if (Number.isFinite(diffNs) && diffNs >= 0) {
              backendReceiptMs = Number((diffNs / 1e6).toFixed(3));
            }
          } catch {
            // fallback kept
          }
        }

        const evalResult = evaluateWaterState({
          flowRate,
          presenceDetected,
          waterDetected,
          unattendedFlowSeconds,
          thresholds: this.thresholds,
        });

        const intervalMinutes = intervalMs / 60_000;
        const consumptionDeltaLiters = Number((flowRate * intervalMinutes).toFixed(4));
        const wastageDeltaLiters = evalResult.isWastage
          ? Number((Math.max(flowRate, waterDetected ? 0.4 : 0) * intervalMinutes).toFixed(4))
          : 0;

        const previousState: WaterState = device.sensorState;
        const brokerAckMs = this.recentBrokerAckByMsgId.get(messageId) ?? device.lastBrokerAckMs;

        const updatedDevice = this.deviceManager.applyProcessedReading(deviceId, {
          flowRate,
          presenceDetected,
          waterDetected,
          sensorState: evalResult.state,
          unattendedFlowSeconds,
          consumptionDeltaLiters,
          wastageDeltaLiters,
          receivedAt,
          backendReceiptMs,
        });

        const backendProcessMs = Number(
          (Number(process.hrtime.bigint() - receivedHrNs) / 1e6).toFixed(3)
        );

        const reading = this.db.insertReading({
          messageId,
          deviceId,
          deviceName: device.name,
          location: device.location,
          topic,
          qos,
          flowRate,
          presenceDetected,
          waterDetected,
          sensorState: evalResult.state,
          consumptionDeltaLiters,
          wastageDeltaLiters,
          publishedAt,
          receivedAt,
          brokerAckMs,
          backendReceiptMs,
          backendProcessMs,
          softwareGenerated: true,
        });

        const mqttEvent = this.db.insertMqttEvent({
          messageId,
          eventType: 'PUBLISH',
          clientId: device.clientId,
          topic,
          qos,
          retain,
          payloadSize,
          payloadPreview: payloadText.slice(0, 320),
          brokerAckMs,
          backendReceiptMs,
          createdAt: receivedAt,
        });

        recordLatency(this.backendReceiptLatency, backendReceiptMs);
        recordLatency(this.backendProcessLatency, backendProcessMs);
        this.windowReceipt.push(backendReceiptMs);
        this.windowProcess.push(backendProcessMs);
        this.successfulProcessing += 1;

        this.emit('readingCreated', reading);
        this.emit('mqttEvent', mqttEvent);
        if (updatedDevice) {
          this.emit('deviceUpdated', updatedDevice);
        }
        this.emit('topologyPulse', {
          id: messageId,
          source: deviceId,
          target: 'mqtt-broker',
          topic,
          qos,
          sensorState: evalResult.state,
          timestamp: receivedAt,
        });

        // Generate alert on transition into an abnormal water state (or escalation)
        const isAbnormal = evalResult.state !== 'NORMAL' && evalResult.state !== 'NORMAL_FLOW';
        if (isAbnormal && evalResult.state !== previousState) {
          const alert = this.db.insertAlert({
            deviceId,
            deviceName: device.name,
            location: device.location,
            severity: evalResult.state as Exclude<WaterState, 'NORMAL' | 'NORMAL_FLOW'>,
            previousState,
            flowRate,
            waterDetected,
            presenceDetected,
            estimatedWastageLiters: updatedDevice?.estimatedWastageLiters ?? device.estimatedWastageLiters,
            message: evalResult.reason,
            topic: device.alertTopic,
            acknowledged: false,
            acknowledgedAt: null,
            createdAt: receivedAt,
          });
          this.emit('alertCreated', alert);

          // Publish alert message over MQTT to the device's alert topic
          if (this.backendClient?.connected) {
            this.backendClient.publish(
              device.alertTopic,
              JSON.stringify({
                alertId: alert.id,
                deviceId,
                severity: alert.severity,
                flowRate,
                message: alert.message,
                timestamp: receivedAt,
              }),
              { qos: 1, retain: false }
            );
          }
        }
      } else if (channel === 'status') {
        const reason = String(data.reason || '');
        const deviceId = String(data.deviceId || parts[3] || '');
        const clientId = String(data.clientId || `hydro-virt-${deviceId}`);
        const device = this.deviceManager.getDevice(deviceId);
        const isLwt = reason === 'LWT_UNEXPECTED_DISCONNECT';

        const mqttEvent = this.db.insertMqttEvent({
          messageId: `status-${Date.now()}-${deviceId}`,
          eventType: isLwt ? 'LWT' : 'PUBLISH',
          clientId,
          topic,
          qos,
          retain,
          payloadSize,
          payloadPreview: payloadText.slice(0, 320),
          brokerAckMs: null,
          backendReceiptMs: null,
          createdAt: receivedAt,
        });
        this.emit('mqttEvent', mqttEvent);

        if (isLwt) {
          const netEvent = this.db.insertNetworkEvent({
            eventType: 'DEVICE_LWT_TRIGGERED',
            targetId: deviceId,
            targetName: device?.name ?? deviceId,
            detectionMethod: 'LWT',
            severity: 'CRITICAL',
            details: `MQTT Broker delivered Last Will & Testament (LWT) on ${topic} confirming unexpected client drop.`,
            failureAt: receivedAt,
            recoveredAt: null,
            downtimeMs: null,
            createdAt: receivedAt,
          });
          this.emit('networkEvent', netEvent);
        }
        this.successfulProcessing += 1;
      } else if (channel === 'alert') {
        const deviceId = String(data.deviceId || parts[3] || '');
        const mqttEvent = this.db.insertMqttEvent({
          messageId: `alert-${Date.now()}-${deviceId}`,
          eventType: 'PUBLISH',
          clientId: this.backendClientId,
          topic,
          qos,
          retain,
          payloadSize,
          payloadPreview: payloadText.slice(0, 320),
          brokerAckMs: null,
          backendReceiptMs: null,
          createdAt: receivedAt,
        });
        this.emit('mqttEvent', mqttEvent);
        this.successfulProcessing += 1;
      }
    } catch (err) {
      this.failedProcessing += 1;
      const errEvent = this.db.insertMqttEvent({
        messageId: `err-${Date.now()}`,
        eventType: 'ERROR',
        clientId: this.backendClientId,
        topic,
        qos,
        retain,
        payloadSize,
        payloadPreview: `Processing error: ${(err as Error).message}`,
        brokerAckMs: null,
        backendReceiptMs: null,
        createdAt: receivedAt,
      });
      this.emit('mqttEvent', errEvent);
    }
  }

  private startHeartbeatMonitor(): void {
    this.heartbeatTimer = setInterval(() => {
      const nowMs = Date.now();
      const timeoutMs = this.thresholds.heartbeatTimeoutSec * 1000;
      const devices = this.deviceManager.listDevices();

      for (const dev of devices) {
        if (dev.connectionStatus !== 'CONNECTED') continue;
        const lastRef = dev.lastPublishAt || dev.connectedAt;
        if (!lastRef) continue;
        const ageMs = nowMs - new Date(lastRef).getTime();
        if (ageMs > timeoutMs) {
          const marked = this.deviceManager.markDeviceSilent(dev.id);
          if (marked) {
            const netEvent = this.db.insertNetworkEvent({
              eventType: 'DEVICE_SILENT_TIMEOUT',
              targetId: dev.id,
              targetName: dev.name,
              detectionMethod: 'HEARTBEAT_TIMEOUT',
              severity: 'WARNING',
              details: `MQTT client ${dev.clientId} remains TCP-connected to broker, but stopped publishing sensor telemetry for >${this.thresholds.heartbeatTimeoutSec}s (distinct from MQTT disconnect).`,
              failureAt: new Date(nowMs).toISOString(),
              recoveredAt: null,
              downtimeMs: null,
              createdAt: new Date(nowMs).toISOString(),
            });
            this.emit('networkEvent', netEvent);
          }
        }
      }
    }, 2000);
  }

  private startAnalyticsTicker(): void {
    this.analyticsTimer = setInterval(() => {
      const now = new Date();
      this.currentMsgPerSec = this.windowMessages;
      this.currentBytesPerSec = this.windowBytes;

      const avg = (arr: number[]) =>
        arr.length === 0 ? 0 : Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));

      const devices = this.deviceManager.listDevices();
      const activeClients = devices.filter((d) => d.connectionStatus === 'CONNECTED').length;
      const offlineClients = devices.filter(
        (d) => d.connectionStatus === 'DISCONNECTED' || d.connectionStatus === 'RECONNECTING' || d.connectionStatus === 'STOPPED'
      ).length;
      const totalFlowRateLpm = Number(
        devices
          .filter((d) => d.connectionStatus === 'CONNECTED')
          .reduce((sum, d) => sum + d.flowRate, 0)
          .toFixed(2)
      );

      const point: AnalyticsPoint = {
        timestamp: now.toISOString(),
        label: now.toTimeString().slice(0, 8),
        messagesPerSec: this.currentMsgPerSec,
        throughputBytesPerSec: this.currentBytesPerSec,
        avgBrokerAckMs: avg(this.windowBrokerAck),
        avgBackendReceiptMs: avg(this.windowReceipt),
        avgBackendProcessMs: avg(this.windowProcess),
        activeClients,
        offlineClients,
        totalFlowRateLpm,
      };

      this.analyticsHistory.push(point);
      if (this.analyticsHistory.length > 60) {
        this.analyticsHistory.shift();
      }

      this.windowMessages = 0;
      this.windowBytes = 0;
      this.windowBrokerAck = [];
      this.windowReceipt = [];
      this.windowProcess = [];

      this.emit('analyticsTick', {
        analytics: this.getAnalyticsSummary(),
        broker: this.broker.getStatus(),
        topics: this.getTopicActivities(),
        wsClients: this.getWsClientCount(),
        dbCounts: this.db.getCounts(),
      });
    }, 1000);
  }

  public getTopicActivities(): TopicActivity[] {
    return Array.from(this.topicMap.values()).sort((a, b) => b.messageCount - a.messageCount);
  }

  public getAnalyticsSummary(): NetworkAnalyticsSummary {
    const devices = this.deviceManager.listDevices();
    const activeClients = devices.filter((d) => d.connectionStatus === 'CONNECTED').length;
    const silentClients = devices.filter((d) => d.connectionStatus === 'SILENT').length;
    const offlineClients = devices.filter(
      (d) => d.connectionStatus === 'DISCONNECTED' || d.connectionStatus === 'RECONNECTING' || d.connectionStatus === 'STOPPED'
    ).length;

    return {
      messagesPerSecond: this.currentMsgPerSec,
      throughputBytesPerSecond: this.currentBytesPerSec,
      totalPublished: this.totalPublished,
      totalReceived: this.totalReceived,
      totalAcknowledged: this.totalAcknowledged,
      successfulProcessing: this.successfulProcessing,
      failedProcessing: this.failedProcessing,
      totalReconnections: this.totalReconnections,
      totalDroppedSimulated: this.totalDroppedSimulated,
      activeClients,
      offlineClients,
      silentClients,
      brokerAvailabilityPct: this.broker.getStatus().availabilityPct,
      latency: {
        brokerAck: summarizeLatency(this.brokerAckLatency),
        backendReceipt: summarizeLatency(this.backendReceiptLatency),
        backendProcess: summarizeLatency(this.backendProcessLatency),
      },
      history: [...this.analyticsHistory],
    };
  }

  public getSnapshot(): SystemStatusSnapshot {
    const brokerStatus = this.broker.getStatus();
    return {
      broker: brokerStatus,
      backend: {
        status: this.backendClient?.connected ? 'ONLINE' : 'DEGRADED',
        subscriberConnected: Boolean(this.backendClient?.connected),
        subscriberClientId: this.backendClientId,
        startedAt: this.startedAtIso,
        uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
        apiKeyProtected: Boolean(process.env.HYDRO_API_KEY),
      },
      database: {
        engine: 'SQLite (Node.js native node:sqlite)',
        status: 'CONNECTED',
        path: this.db.dbPath === ':memory:' ? ':memory:' : 'data/hydro_network.db',
        counts: this.db.getCounts(),
      },
      websocket: {
        connectedDashboards: this.getWsClientCount(),
        endpoint: '/ws',
      },
      devices: this.deviceManager.listDevices(),
      thresholds: this.getThresholds(),
      analytics: this.getAnalyticsSummary(),
      topics: this.getTopicActivities(),
      recentReadings: this.db.getRecentReadings(60),
      recentAlerts: this.db.getAlerts(60),
      recentMqttEvents: this.db.getRecentMqttEvents(80),
      recentNetworkEvents: this.db.getRecentNetworkEvents(60),
      qosExperiments: this.db.getQosExperiments(25),
    };
  }

  /**
   * Real MQTT QoS 0 / 1 / 2 Laboratory Experiment Runner.
   * Connects dedicated TCP MQTT publisher and subscriber clients to the live broker.
   */
  public async runQosExperiment(options: {
    qos: MqttQoS;
    messageCount: number;
    simulatedDelayMs?: number;
    packetLossPct?: number;
    simulateDuplicateResend?: boolean;
  }): Promise<QosExperimentResult> {
    if (this.broker.getStatus().status !== 'ONLINE') {
      throw new Error('MQTT broker is currently interrupted. Restore the broker before running a QoS test.');
    }

    const qos = options.qos;
    const messageCount = Math.max(1, Math.min(100, Math.round(options.messageCount)));
    const simulatedDelayMs = Math.max(0, Math.min(200, Math.round(options.simulatedDelayMs ?? 0)));
    const packetLossPct = Math.max(0, Math.min(50, Math.round(options.packetLossPct ?? 0)));
    const simulateDuplicateResend = Boolean(options.simulateDuplicateResend && qos === 1);

    const runId = `qos${qos}-${crypto.randomBytes(3).toString('hex')}`;
    const topic = `hydro/qos/lab/${runId}`;
    const startedAt = new Date().toISOString();
    const auth = this.broker.getAuthCredentials();

    const subClient = mqtt.connect(this.broker.getBrokerUrl(), {
      clientId: `hydro-qos-sub-${runId}`,
      clean: true,
      reconnectPeriod: 0,
      username: auth.username,
      password: auth.password,
    });

    const pubClient = mqtt.connect(this.broker.getBrokerUrl(), {
      clientId: `hydro-qos-pub-${runId}`,
      clean: true,
      reconnectPeriod: 0,
      username: auth.username,
      password: auth.password,
    });

    const seenSeqs = new Set<number>();
    const brokerAckSamples: number[] = [];
    const deliverySamples: number[] = [];
    let publishedCount = 0;
    let acknowledgedCount = 0;
    let receivedCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          subClient.once('connect', () => {
            subClient.subscribe(topic, { qos }, (err) => (err ? reject(err) : resolve()));
          });
          subClient.once('error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          pubClient.once('connect', () => resolve());
          pubClient.once('error', reject);
        }),
      ]);

      subClient.on('message', (_t, buf) => {
        const nowHr = process.hrtime.bigint();
        try {
          const parsed = JSON.parse(buf.toString('utf8')) as {
            seq: number;
            hrSendNs: string;
          };
          const latencyMs = Number((Number(nowHr - BigInt(parsed.hrSendNs)) / 1e6).toFixed(3));
          if (seenSeqs.has(parsed.seq)) {
            duplicateCount += 1;
          } else {
            seenSeqs.add(parsed.seq);
            receivedCount += 1;
            deliverySamples.push(Math.max(0, latencyMs));
          }
        } catch {
          failedCount += 1;
        }
      });

      for (let seq = 1; seq <= messageCount; seq += 1) {
        if (simulatedDelayMs > 0) {
          await new Promise((r) => setTimeout(r, simulatedDelayMs));
        }

        // Optional simulated transport drop before publishing to contrast QoS 0 loss vs retry behavior
        if (packetLossPct > 0 && Math.random() * 100 < packetLossPct) {
          if (qos === 0) {
            // QoS 0 fire-and-forget: dropped frame is permanently lost
            failedCount += 1;
            continue;
          }
          // QoS 1 & 2 retransmit on missing acknowledgement
        }

        const hrSendNs = process.hrtime.bigint();
        const payload = JSON.stringify({
          runId,
          seq,
          qos,
          hrSendNs: hrSendNs.toString(),
          timestamp: new Date().toISOString(),
        });

        publishedCount += 1;
        await new Promise<void>((resolve) => {
          pubClient.publish(topic, payload, { qos }, (err) => {
            if (err) {
              failedCount += 1;
            } else {
              const ackMs = Number((Number(process.hrtime.bigint() - hrSendNs) / 1e6).toFixed(3));
              acknowledgedCount += 1;
              brokerAckSamples.push(Math.max(0, ackMs));
            }
            resolve();
          });
        });

        // Demonstrate QoS 1 at-least-once duplicate delivery when sender retransmits an unacknowledged PUBLISH
        if (simulateDuplicateResend && seq % 5 === 0) {
          await new Promise<void>((resolve) => {
            pubClient.publish(topic, payload, { qos: 1 }, () => resolve());
          });
        }
      }

      // Allow final QoS 2 PUBREL/PUBCOMP frames to settle
      await new Promise((r) => setTimeout(r, qos === 2 ? 250 : 120));
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => pubClient.end(true, {}, () => resolve())),
        new Promise<void>((resolve) => subClient.end(true, {}, () => resolve())),
      ]);
    }

    const stats = (arr: number[]) => {
      if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
      const sum = arr.reduce((a, b) => a + b, 0);
      return {
        avg: Number((sum / arr.length).toFixed(2)),
        min: Number(Math.min(...arr).toFixed(2)),
        max: Number(Math.max(...arr).toFixed(2)),
      };
    };

    const ackStats = stats(brokerAckSamples);
    const delStats = stats(deliverySamples);

    const handshakeByQos: Record<MqttQoS, string[]> = {
      0: ['PUBLISH (QoS 0 — fire and forget, no broker ACK)'],
      1: ['PUBLISH (QoS 1)', 'PUBACK (Broker confirms receipt; retries may cause duplicates)'],
      2: [
        'PUBLISH (QoS 2)',
        'PUBREC (Broker stores packet ID)',
        'PUBREL (Publisher releases packet ID)',
        'PUBCOMP (4-way handshake complete — exactly once at MQTT protocol level)',
      ],
    };

    const protocolNoteByQos: Record<MqttQoS, string> = {
      0: 'At-most-once delivery: lowest overhead and latency, no PUBACK frame; dropped frames are never retransmitted.',
      1: 'At-least-once delivery: guaranteed broker acknowledgement via PUBACK, but retransmissions after lost PUBACK can produce duplicate deliveries requiring idempotent consumers.',
      2: 'Exactly-once delivery at the MQTT protocol layer via 4-step PUBLISH/PUBREC/PUBREL/PUBCOMP handshake; higher overhead and does not replace application-level transactional database idempotency.',
    };

    const result = this.db.insertQosExperiment({
      runId,
      qos,
      messageCount,
      publishedCount,
      acknowledgedCount,
      receivedCount,
      failedCount,
      duplicateCount,
      avgBrokerAckMs: ackStats.avg,
      minBrokerAckMs: ackStats.min,
      maxBrokerAckMs: ackStats.max,
      avgDeliveryMs: delStats.avg,
      minDeliveryMs: delStats.min,
      maxDeliveryMs: delStats.max,
      packetLossPct,
      simulatedDelayMs,
      handshakeSequence: handshakeByQos[qos],
      protocolNote: protocolNoteByQos[qos],
      startedAt,
      completedAt: new Date().toISOString(),
    });

    this.emit('qosCompleted', result);
    return result;
  }

  public async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.analyticsTimer) {
      clearInterval(this.analyticsTimer);
      this.analyticsTimer = null;
    }
    if (this.backendClient) {
      await new Promise<void>((resolve) => this.backendClient?.end(true, {}, () => resolve()));
      this.backendClient = null;
    }
  }
}
