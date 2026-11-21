export type WaterState =
  | 'NORMAL'
  | 'NORMAL_FLOW'
  | 'WARNING'
  | 'ALERT'
  | 'LEAK'
  | 'CRITICAL';

export type MqttQoS = 0 | 1 | 2;

export type DeviceConnectionStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECTING'
  | 'SILENT'
  | 'STOPPED';

export type WaterScenario =
  | 'NORMAL_IDLE'
  | 'NORMAL_USAGE'
  | 'UNATTENDED_FLOW'
  | 'CONTINUOUS_WASTAGE'
  | 'WATER_CONTACT_NO_FLOW'
  | 'CRITICAL_LEAKAGE';

export interface VirtualDevice {
  id: string;
  name: string;
  location: string;
  zone: string;
  clientId: string;
  topicBase: string;
  sensorTopic: string;
  statusTopic: string;
  alertTopic: string;
  flowRate: number;
  presenceDetected: boolean;
  waterDetected: boolean;
  sensorState: WaterState;
  totalConsumptionLiters: number;
  estimatedWastageLiters: number;
  connectionStatus: DeviceConnectionStatus;
  isRunning: boolean;
  publishingPaused: boolean;
  publishIntervalMs: number;
  qos: MqttQoS;
  simulatedDelayMs: number;
  simulatedPacketLossPct: number;
  scenario: WaterScenario;
  lastCommunicationAt: string | null;
  lastPublishAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  reconnectCount: number;
  messagesPublished: number;
  messagesAcknowledged: number;
  messagesDropped: number;
  unattendedFlowSeconds: number;
  lastBrokerAckMs: number | null;
  lastBackendReceiptMs: number | null;
  softwareGenerated: true;
}

export interface SensorReadingRecord {
  id: number;
  messageId: string;
  deviceId: string;
  deviceName: string;
  location: string;
  topic: string;
  qos: MqttQoS;
  flowRate: number;
  presenceDetected: boolean;
  waterDetected: boolean;
  sensorState: WaterState;
  consumptionDeltaLiters: number;
  wastageDeltaLiters: number;
  publishedAt: string;
  receivedAt: string;
  brokerAckMs: number | null;
  backendReceiptMs: number;
  backendProcessMs: number;
  softwareGenerated: boolean;
}

export interface WaterAlertRecord {
  id: number;
  deviceId: string;
  deviceName: string;
  location: string;
  severity: Exclude<WaterState, 'NORMAL' | 'NORMAL_FLOW'>;
  previousState: WaterState;
  flowRate: number;
  waterDetected: boolean;
  presenceDetected: boolean;
  estimatedWastageLiters: number;
  message: string;
  topic: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface MqttEventRecord {
  id: number;
  messageId: string;
  eventType:
    | 'PUBLISH'
    | 'PUBACK'
    | 'CONNECT'
    | 'DISCONNECT'
    | 'LWT'
    | 'SUBSCRIBE'
    | 'ERROR';
  clientId: string;
  topic: string;
  qos: MqttQoS;
  retain: boolean;
  payloadSize: number;
  payloadPreview: string;
  brokerAckMs: number | null;
  backendReceiptMs: number | null;
  createdAt: string;
}

export interface NetworkFailureEvent {
  id: number;
  eventType:
    | 'DEVICE_DISCONNECTED'
    | 'DEVICE_LWT_TRIGGERED'
    | 'DEVICE_SILENT_TIMEOUT'
    | 'DEVICE_RECONNECTED'
    | 'DEVICE_STOPPED'
    | 'DEVICE_STARTED'
    | 'BROKER_INTERRUPTED'
    | 'BROKER_RESTORED'
    | 'FAULT_INJECTED'
    | 'COMMUNICATION_RESTORED';
  targetId: string;
  targetName: string;
  detectionMethod: 'LWT' | 'TCP_CLOSE' | 'HEARTBEAT_TIMEOUT' | 'BROKER_EVENT' | 'USER_CONTROL';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  details: string;
  failureAt: string | null;
  recoveredAt: string | null;
  downtimeMs: number | null;
  createdAt: string;
}

export interface QosExperimentResult {
  id: number;
  runId: string;
  qos: MqttQoS;
  messageCount: number;
  publishedCount: number;
  acknowledgedCount: number;
  receivedCount: number;
  failedCount: number;
  duplicateCount: number;
  avgBrokerAckMs: number;
  minBrokerAckMs: number;
  maxBrokerAckMs: number;
  avgDeliveryMs: number;
  minDeliveryMs: number;
  maxDeliveryMs: number;
  packetLossPct: number;
  simulatedDelayMs: number;
  handshakeSequence: string[];
  protocolNote: string;
  startedAt: string;
  completedAt: string;
}

export interface BrokerStatus {
  mode: 'embedded' | 'external';
  status: 'ONLINE' | 'INTERRUPTED' | 'RECOVERING';
  host: string;
  port: number;
  protocol: string;
  startedAt: string;
  uptimeSeconds: number;
  interruptedAt: string | null;
  totalDowntimeMs: number;
  availabilityPct: number;
  connectedClients: string[];
  publishers: string[];
  subscribers: string[];
  activeSubscriptions: Array<{ clientId: string; topic: string; qos: number }>;
  authEnabled: boolean;
}

export interface TopicActivity {
  topic: string;
  messageCount: number;
  lastQos: MqttQoS;
  lastPayloadSize: number;
  lastMessageAt: string;
  lastDeviceId: string;
}

export interface AnalyticsPoint {
  timestamp: string;
  label: string;
  messagesPerSec: number;
  throughputBytesPerSec: number;
  avgBrokerAckMs: number;
  avgBackendReceiptMs: number;
  avgBackendProcessMs: number;
  activeClients: number;
  offlineClients: number;
  totalFlowRateLpm: number;
}

export interface NetworkAnalyticsSummary {
  messagesPerSecond: number;
  throughputBytesPerSecond: number;
  totalPublished: number;
  totalReceived: number;
  totalAcknowledged: number;
  successfulProcessing: number;
  failedProcessing: number;
  totalReconnections: number;
  totalDroppedSimulated: number;
  activeClients: number;
  offlineClients: number;
  silentClients: number;
  brokerAvailabilityPct: number;
  latency: {
    brokerAck: { avgMs: number; minMs: number; maxMs: number; samples: number };
    backendReceipt: { avgMs: number; minMs: number; maxMs: number; samples: number };
    backendProcess: { avgMs: number; minMs: number; maxMs: number; samples: number };
  };
  history: AnalyticsPoint[];
}

export interface WaterThresholds {
  flowActiveThresholdLpm: number;
  warningUnattendedSec: number;
  alertWastageSec: number;
  criticalFlowThresholdLpm: number;
  heartbeatTimeoutSec: number;
  maxDevices: number;
  defaultPublishIntervalMs: number;
}

export interface SystemStatusSnapshot {
  broker: BrokerStatus;
  backend: {
    status: 'ONLINE' | 'DEGRADED';
    subscriberConnected: boolean;
    subscriberClientId: string;
    startedAt: string;
    uptimeSeconds: number;
    apiKeyProtected: boolean;
  };
  database: {
    engine: string;
    status: 'CONNECTED' | 'ERROR';
    path: string;
    counts: {
      devices: number;
      readings: number;
      alerts: number;
      mqttEvents: number;
      networkEvents: number;
      qosExperiments: number;
    };
  };
  websocket: {
    connectedDashboards: number;
    endpoint: string;
  };
  devices: VirtualDevice[];
  thresholds: WaterThresholds;
  analytics: NetworkAnalyticsSummary;
  topics: TopicActivity[];
  recentReadings: SensorReadingRecord[];
  recentAlerts: WaterAlertRecord[];
  recentMqttEvents: MqttEventRecord[];
  recentNetworkEvents: NetworkFailureEvent[];
  qosExperiments: QosExperimentResult[];
}

export interface TopologyPulse {
  id: string;
  source: string;
  target: string;
  topic: string;
  qos: MqttQoS;
  sensorState?: WaterState;
  timestamp: string;
}

export type WsServerEvent =
  | { type: 'init'; payload: SystemStatusSnapshot }
  | { type: 'device:updated'; payload: VirtualDevice }
  | { type: 'devices:sync'; payload: VirtualDevice[] }
  | { type: 'reading:created'; payload: SensorReadingRecord }
  | { type: 'alert:created'; payload: WaterAlertRecord }
  | { type: 'alert:updated'; payload: WaterAlertRecord }
  | { type: 'mqtt:event'; payload: MqttEventRecord }
  | { type: 'network:event'; payload: NetworkFailureEvent }
  | { type: 'analytics:tick'; payload: { analytics: NetworkAnalyticsSummary; broker: BrokerStatus; topics: TopicActivity[]; wsClients: number; dbCounts: SystemStatusSnapshot['database']['counts'] } }
  | { type: 'topology:pulse'; payload: TopologyPulse }
  | { type: 'qos:completed'; payload: QosExperimentResult }
  | { type: 'thresholds:updated'; payload: WaterThresholds };
