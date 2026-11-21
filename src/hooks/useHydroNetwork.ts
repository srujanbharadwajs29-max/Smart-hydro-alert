import { useCallback, useEffect, useRef, useState } from 'react';
import { hydroApi } from '../lib/api';
import type {
  SystemStatusSnapshot,
  TopologyPulse,
  WsServerEvent,
} from '../types/hydro';

export type WsConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export function useHydroNetwork() {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot | null>(null);
  const [wsState, setWsState] = useState<WsConnectionState>('CONNECTING');
  const [error, setError] = useState<string | null>(null);
  const [pulses, setPulses] = useState<TopologyPulse[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadSnapshotFallback = useCallback(async () => {
    try {
      const data = await hydroApi.getSnapshot();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) return;
          setWsState('CONNECTED');
          setError(null);
        };

        ws.onmessage = (evt) => {
          if (disposed) return;
          try {
            const msg = JSON.parse(evt.data as string) as WsServerEvent;
            handleEvent(msg);
          } catch {
            // ignore malformed frame
          }
        };

        ws.onerror = () => {
          if (disposed) return;
          setWsState('RECONNECTING');
        };

        ws.onclose = () => {
          if (disposed) return;
          setWsState('RECONNECTING');
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        };
      } catch {
        setWsState('ERROR');
        reconnectTimerRef.current = window.setTimeout(connect, 2500);
      }
    };

    const handleEvent = (msg: WsServerEvent) => {
      if (msg.type === 'init') {
        setSnapshot(msg.payload);
        return;
      }

      if (msg.type === 'topology:pulse') {
        setPulses((prev) => [msg.payload, ...prev].slice(0, 20));
        return;
      }

      setSnapshot((prev) => {
        if (!prev) return prev;
        switch (msg.type) {
          case 'device:updated': {
            const exists = prev.devices.some((d) => d.id === msg.payload.id);
            const devices = exists
              ? prev.devices.map((d) => (d.id === msg.payload.id ? msg.payload : d))
              : [...prev.devices, msg.payload];
            return { ...prev, devices };
          }
          case 'devices:sync':
            return { ...prev, devices: msg.payload };
          case 'reading:created': {
            if (prev.recentReadings.some((r) => r.id === msg.payload.id)) return prev;
            return {
              ...prev,
              recentReadings: [msg.payload, ...prev.recentReadings].slice(0, 120),
            };
          }
          case 'alert:created': {
            if (prev.recentAlerts.some((a) => a.id === msg.payload.id)) return prev;
            return {
              ...prev,
              recentAlerts: [msg.payload, ...prev.recentAlerts].slice(0, 100),
            };
          }
          case 'alert:updated':
            return {
              ...prev,
              recentAlerts: prev.recentAlerts.map((a) =>
                a.id === msg.payload.id ? msg.payload : a
              ),
            };
          case 'mqtt:event': {
            if (prev.recentMqttEvents.some((e) => e.id === msg.payload.id)) return prev;
            return {
              ...prev,
              recentMqttEvents: [msg.payload, ...prev.recentMqttEvents].slice(0, 150),
            };
          }
          case 'network:event': {
            if (prev.recentNetworkEvents.some((e) => e.id === msg.payload.id)) return prev;
            return {
              ...prev,
              recentNetworkEvents: [msg.payload, ...prev.recentNetworkEvents].slice(0, 100),
            };
          }
          case 'analytics:tick':
            return {
              ...prev,
              analytics: msg.payload.analytics,
              broker: msg.payload.broker,
              topics: msg.payload.topics,
              websocket: {
                ...prev.websocket,
                connectedDashboards: msg.payload.wsClients,
              },
              database: {
                ...prev.database,
                counts: msg.payload.dbCounts,
              },
            };
          case 'qos:completed': {
            if (prev.qosExperiments.some((q) => q.runId === msg.payload.runId)) return prev;
            return {
              ...prev,
              qosExperiments: [msg.payload, ...prev.qosExperiments].slice(0, 30),
            };
          }
          case 'thresholds:updated':
            return { ...prev, thresholds: msg.payload };
          default:
            return prev;
        }
      });
    };

    // Fetch initial snapshot immediately so UI renders without waiting for WS handshake
    loadSnapshotFallback();
    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [loadSnapshotFallback]);

  return {
    snapshot,
    wsState,
    error,
    pulses,
    refresh: loadSnapshotFallback,
  };
}
