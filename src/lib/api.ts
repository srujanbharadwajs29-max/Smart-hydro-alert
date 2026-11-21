import type {
  MqttQoS,
  QosExperimentResult,
  SystemStatusSnapshot,
  VirtualDevice,
  WaterAlertRecord,
  WaterScenario,
  WaterThresholds,
} from '../types/hydro';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep fallback message
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const hydroApi = {
  getSnapshot: () => requestJson<SystemStatusSnapshot>('/api/snapshot'),

  // Virtual Devices
  addDevice: (input: {
    name: string;
    location: string;
    zone?: string;
    qos?: MqttQoS;
    publishIntervalMs?: number;
    scenario?: WaterScenario;
  }) =>
    requestJson<VirtualDevice>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  removeDevice: (id: string) =>
    requestJson<{ removed: boolean; id: string }>(`/api/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  startDevice: (id: string) =>
    requestJson<VirtualDevice>(`/api/devices/${encodeURIComponent(id)}/start`, {
      method: 'POST',
    }),

  stopDevice: (id: string) =>
    requestJson<VirtualDevice>(`/api/devices/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    }),

  restartDevice: (id: string) =>
    requestJson<VirtualDevice>(`/api/devices/${encodeURIComponent(id)}/restart`, {
      method: 'POST',
    }),

  resetDevice: (id: string) =>
    requestJson<VirtualDevice>(`/api/devices/${encodeURIComponent(id)}/reset`, {
      method: 'POST',
    }),

  startAllDevices: () =>
    requestJson<VirtualDevice[]>('/api/devices/start-all', { method: 'POST' }),

  stopAllDevices: () =>
    requestJson<VirtualDevice[]>('/api/devices/stop-all', { method: 'POST' }),

  updateDeviceConfig: (
    id: string,
    patch: Partial<{
      publishIntervalMs: number;
      qos: MqttQoS;
      scenario: WaterScenario;
      publishingPaused: boolean;
      simulatedDelayMs: number;
      simulatedPacketLossPct: number;
    }>
  ) =>
    requestJson<VirtualDevice>(`/api/devices/${encodeURIComponent(id)}/config`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  triggerScenario: (id: string, scenario: WaterScenario) =>
    requestJson<VirtualDevice>(`/api/devices/${encodeURIComponent(id)}/scenario`, {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    }),

  // Network Failure Simulator
  disconnectDevice: (deviceId: string, abrupt = true) =>
    requestJson<VirtualDevice>('/api/failures/disconnect-device', {
      method: 'POST',
      body: JSON.stringify({ deviceId, abrupt }),
    }),

  disconnectMultiple: (deviceIds?: string[], abrupt = true) =>
    requestJson<{ disconnected: number; devices: VirtualDevice[] }>(
      '/api/failures/disconnect-multiple',
      {
        method: 'POST',
        body: JSON.stringify({ deviceIds, abrupt }),
      }
    ),

  pausePublishing: (deviceId: string, paused: boolean) =>
    requestJson<VirtualDevice>('/api/failures/pause-publishing', {
      method: 'POST',
      body: JSON.stringify({ deviceId, paused }),
    }),

  setDeviceImpairment: (deviceId: string, simulatedDelayMs: number, simulatedPacketLossPct: number) =>
    requestJson<VirtualDevice>('/api/failures/device-impairment', {
      method: 'POST',
      body: JSON.stringify({ deviceId, simulatedDelayMs, simulatedPacketLossPct }),
    }),

  interruptBroker: (durationSec?: number) =>
    requestJson<{ interruptedAt: string }>('/api/failures/broker/interrupt', {
      method: 'POST',
      body: JSON.stringify({ durationSec }),
    }),

  restoreBroker: () =>
    requestJson<{ restoredAt: string; downtimeMs: number }>('/api/failures/broker/restore', {
      method: 'POST',
    }),

  restoreAllCommunication: () =>
    requestJson<{ restored: boolean; devices: VirtualDevice[] }>('/api/failures/restore-all', {
      method: 'POST',
    }),

  // QoS Lab
  runQosExperiment: (params: {
    qos: MqttQoS;
    messageCount: number;
    simulatedDelayMs?: number;
    packetLossPct?: number;
    simulateDuplicateResend?: boolean;
  }) =>
    requestJson<QosExperimentResult>('/api/qos/run', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  // Alerts & Settings
  acknowledgeAlert: (id: number) =>
    requestJson<WaterAlertRecord>(`/api/alerts/${id}/ack`, { method: 'POST' }),

  updateSettings: (thresholds: Partial<WaterThresholds>) =>
    requestJson<WaterThresholds>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(thresholds),
    }),

  clearHistory: () =>
    requestJson<{ cleared: boolean }>('/api/settings/clear-history', {
      method: 'POST',
    }),
};
