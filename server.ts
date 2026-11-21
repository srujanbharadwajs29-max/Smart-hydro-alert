import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { MqttQoS, WaterScenario, WsServerEvent } from './src/types/hydro.ts';
import { HydroDatabase } from './server/database.ts';
import { HydroMqttBroker } from './server/mqttBroker.ts';
import { HydroNetworkEngine } from './server/networkEngine.ts';
import { SCENARIO_CATALOG } from './server/waterIntelligence.ts';
import { VirtualDeviceManager } from './server/virtualDeviceManager.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const VALID_SCENARIOS = new Set<WaterScenario>([
  'NORMAL_IDLE',
  'NORMAL_USAGE',
  'UNATTENDED_FLOW',
  'CONTINUOUS_WASTAGE',
  'WATER_CONTACT_NO_FLOW',
  'CRITICAL_LEAKAGE',
]);

export interface RunningHydroStack {
  app: express.Express;
  httpServer: http.Server;
  wss: WebSocketServer;
  broker: HydroMqttBroker;
  db: HydroDatabase;
  deviceManager: VirtualDeviceManager;
  networkEngine: HydroNetworkEngine;
  shutdown: () => Promise<void>;
}

export async function createHydroServer(options?: {
  dbPath?: string;
  mqttPort?: number;
  autoStartDevices?: boolean;
  attachVite?: boolean;
}): Promise<RunningHydroStack> {
  const db = new HydroDatabase(options?.dbPath);
  const broker = new HydroMqttBroker({ port: options?.mqttPort });
  await broker.start();

  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  let deviceManager!: VirtualDeviceManager;
  let networkEngine!: HydroNetworkEngine;

  deviceManager = new VirtualDeviceManager(broker, db, () =>
    networkEngine ? networkEngine.getThresholds() : db.getThresholds()
  );

  networkEngine = new HydroNetworkEngine(broker, db, deviceManager, () => wss.clients.size);

  const broadcast = (event: WsServerEvent) => {
    const serialized = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  // Wire engine real-time events to WebSocket broadcast
  networkEngine.on('deviceUpdated', (payload) => broadcast({ type: 'device:updated', payload }));
  networkEngine.on('devicesSync', (payload) => broadcast({ type: 'devices:sync', payload }));
  networkEngine.on('readingCreated', (payload) => broadcast({ type: 'reading:created', payload }));
  networkEngine.on('alertCreated', (payload) => broadcast({ type: 'alert:created', payload }));
  networkEngine.on('mqttEvent', (payload) => broadcast({ type: 'mqtt:event', payload }));
  networkEngine.on('networkEvent', (payload) => broadcast({ type: 'network:event', payload }));
  networkEngine.on('analyticsTick', (payload) => broadcast({ type: 'analytics:tick', payload }));
  networkEngine.on('topologyPulse', (payload) => broadcast({ type: 'topology:pulse', payload }));
  networkEngine.on('qosCompleted', (payload) => broadcast({ type: 'qos:completed', payload }));
  networkEngine.on('thresholdsUpdated', (payload) =>
    broadcast({ type: 'thresholds:updated', payload })
  );

  await networkEngine.start();
  await deviceManager.initializeDefaults(options?.autoStartDevices ?? true);

  // Express JSON body parsing with safe size cap
  app.use(express.json({ limit: '64kb' }));

  // Restricted CORS handling (never wildcard on API-key-protected endpoints)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed = [
      process.env.ALLOWED_ORIGIN,
      process.env.APP_URL,
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
    ].filter(Boolean);

    if (origin && (allowed.includes(origin) || origin.endsWith('.run.app'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Optional API-key middleware when HYDRO_API_KEY is configured in environment
  const requireApiKeyIfConfigured = (req: Request, res: Response, next: NextFunction) => {
    const configuredKey = process.env.HYDRO_API_KEY;
    if (!configuredKey) {
      next();
      return;
    }
    const provided = req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (provided !== configuredKey) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
      return;
    }
    next();
  };

  // --- API ROUTES ---

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      broker: broker.getStatus().status,
      mqttPort: broker.port,
      wsClients: wss.clients.size,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/snapshot', (_req, res) => {
    res.json(networkEngine.getSnapshot());
  });

  app.get('/api/scenarios', (_req, res) => {
    res.json(SCENARIO_CATALOG);
  });

  app.get('/api/devices', (_req, res) => {
    res.json(deviceManager.listDevices());
  });

  app.post('/api/devices', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const { name, location, zone, qos, publishIntervalMs, scenario } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
        res.status(400).json({ error: 'Device name must be between 2 and 60 characters.' });
        return;
      }
      if (typeof location !== 'string' || location.trim().length < 2 || location.trim().length > 80) {
        res.status(400).json({ error: 'Device location must be between 2 and 80 characters.' });
        return;
      }
      const parsedQos = [0, 1, 2].includes(Number(qos)) ? (Number(qos) as MqttQoS) : 1;
      const parsedScenario: WaterScenario = VALID_SCENARIOS.has(scenario) ? scenario : 'NORMAL_IDLE';

      const created = await deviceManager.addDevice({
        name: name.trim(),
        location: location.trim(),
        zone: typeof zone === 'string' ? zone.trim() : undefined,
        qos: parsedQos,
        publishIntervalMs: Number.isFinite(Number(publishIntervalMs))
          ? Number(publishIntervalMs)
          : undefined,
        scenario: parsedScenario,
      });
      broadcast({ type: 'devices:sync', payload: deviceManager.listDevices() });
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/devices/:id', requireApiKeyIfConfigured, async (req, res) => {
    try {
      await deviceManager.removeDevice(String(req.params.id));
      res.json({ removed: true, id: req.params.id });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/devices/start-all', requireApiKeyIfConfigured, async (_req, res) => {
    const devices = await deviceManager.startAll();
    res.json(devices);
  });

  app.post('/api/devices/stop-all', requireApiKeyIfConfigured, async (_req, res) => {
    const devices = await deviceManager.stopAll();
    res.json(devices);
  });

  app.post('/api/devices/:id/start', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const device = await deviceManager.startDevice(String(req.params.id));
      const netEvent = db.insertNetworkEvent({
        eventType: 'DEVICE_STARTED',
        targetId: device.id,
        targetName: device.name,
        detectionMethod: 'USER_CONTROL',
        severity: 'INFO',
        details: `Virtual MQTT client ${device.clientId} started.`,
        failureAt: null,
        recoveredAt: new Date().toISOString(),
        downtimeMs: null,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'network:event', payload: netEvent });
      res.json(device);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/devices/:id/stop', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const device = await deviceManager.stopDevice(String(req.params.id));
      const netEvent = db.insertNetworkEvent({
        eventType: 'DEVICE_STOPPED',
        targetId: device.id,
        targetName: device.name,
        detectionMethod: 'USER_CONTROL',
        severity: 'INFO',
        details: `Virtual MQTT client ${device.clientId} gracefully stopped.`,
        failureAt: new Date().toISOString(),
        recoveredAt: null,
        downtimeMs: null,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'network:event', payload: netEvent });
      res.json(device);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/devices/:id/restart', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const device = await deviceManager.restartDevice(String(req.params.id));
      res.json(device);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/devices/:id/reset', requireApiKeyIfConfigured, (req, res) => {
    try {
      const device = deviceManager.resetDevice(String(req.params.id));
      res.json(device);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/devices/:id/config', requireApiKeyIfConfigured, (req, res) => {
    try {
      const { publishIntervalMs, qos, scenario, publishingPaused, simulatedDelayMs, simulatedPacketLossPct } =
        req.body ?? {};
      const updated = deviceManager.updateDeviceConfig(String(req.params.id), {
        publishIntervalMs: publishIntervalMs !== undefined ? Number(publishIntervalMs) : undefined,
        qos: qos !== undefined && [0, 1, 2].includes(Number(qos)) ? (Number(qos) as MqttQoS) : undefined,
        scenario: scenario !== undefined && VALID_SCENARIOS.has(scenario) ? scenario : undefined,
        publishingPaused: typeof publishingPaused === 'boolean' ? publishingPaused : undefined,
        simulatedDelayMs: simulatedDelayMs !== undefined ? Number(simulatedDelayMs) : undefined,
        simulatedPacketLossPct:
          simulatedPacketLossPct !== undefined ? Number(simulatedPacketLossPct) : undefined,
      });
      res.json(updated);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/devices/:id/scenario', requireApiKeyIfConfigured, (req, res) => {
    try {
      const { scenario } = req.body ?? {};
      if (!VALID_SCENARIOS.has(scenario)) {
        res.status(400).json({ error: 'Invalid water scenario requested.' });
        return;
      }
      const updated = deviceManager.triggerScenario(String(req.params.id), scenario);
      res.json(updated);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // --- NETWORK FAILURE SIMULATOR ROUTES ---

  app.post('/api/failures/disconnect-device', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const { deviceId, abrupt } = req.body ?? {};
      const updated = await deviceManager.disconnectDevice(String(deviceId), abrupt !== false);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/failures/disconnect-multiple', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const { deviceIds, abrupt } = req.body ?? {};
      const ids: string[] = Array.isArray(deviceIds)
        ? deviceIds.map(String)
        : deviceManager
            .listDevices()
            .slice(0, 3)
            .map((d) => d.id);
      const results = [];
      for (const id of ids) {
        if (deviceManager.getDevice(id)) {
          results.push(await deviceManager.disconnectDevice(id, abrupt !== false));
        }
      }
      res.json({ disconnected: results.length, devices: results });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/failures/pause-publishing', requireApiKeyIfConfigured, (req, res) => {
    try {
      const { deviceId, paused } = req.body ?? {};
      const updated = deviceManager.updateDeviceConfig(String(deviceId), {
        publishingPaused: paused !== false,
      });
      const netEvent = db.insertNetworkEvent({
        eventType: 'FAULT_INJECTED',
        targetId: updated.id,
        targetName: updated.name,
        detectionMethod: 'USER_CONTROL',
        severity: 'WARNING',
        details: updated.publishingPaused
          ? `Halted sensor PUBLISH loop on ${updated.clientId} while keeping MQTT TCP session alive (tests silent-client heartbeat timeout).`
          : `Resumed sensor PUBLISH loop on ${updated.clientId}.`,
        failureAt: updated.publishingPaused ? new Date().toISOString() : null,
        recoveredAt: updated.publishingPaused ? null : new Date().toISOString(),
        downtimeMs: null,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'network:event', payload: netEvent });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/failures/device-impairment', requireApiKeyIfConfigured, (req, res) => {
    try {
      const { deviceId, simulatedDelayMs, simulatedPacketLossPct } = req.body ?? {};
      const updated = deviceManager.updateDeviceConfig(String(deviceId), {
        simulatedDelayMs: Number(simulatedDelayMs ?? 0),
        simulatedPacketLossPct: Number(simulatedPacketLossPct ?? 0),
      });
      const netEvent = db.insertNetworkEvent({
        eventType: 'FAULT_INJECTED',
        targetId: updated.id,
        targetName: updated.name,
        detectionMethod: 'USER_CONTROL',
        severity: 'WARNING',
        details: `Updated client-side transport simulation on ${updated.name}: delay=${updated.simulatedDelayMs}ms, packetDrop=${updated.simulatedPacketLossPct}%.`,
        failureAt: new Date().toISOString(),
        recoveredAt: null,
        downtimeMs: null,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'network:event', payload: netEvent });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/failures/broker/interrupt', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const rawSec = Number(req.body?.durationSec ?? 0);
      const durationMs = rawSec > 0 ? Math.min(60, rawSec) * 1000 : undefined;
      const result = await broker.interrupt(durationMs);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/failures/broker/restore', requireApiKeyIfConfigured, async (_req, res) => {
    try {
      const result = await broker.restore();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/failures/restore-all', requireApiKeyIfConfigured, async (_req, res) => {
    try {
      if (broker.getStatus().status !== 'ONLINE') {
        await broker.restore();
      }
      const devices = await deviceManager.restoreAllFaults();
      const netEvent = db.insertNetworkEvent({
        eventType: 'COMMUNICATION_RESTORED',
        targetId: 'all-nodes',
        targetName: 'All Virtual Nodes & Broker',
        detectionMethod: 'USER_CONTROL',
        severity: 'INFO',
        details: 'Restored MQTT broker, cleared all simulated transport delays/drops, and reconnected all virtual devices.',
        failureAt: null,
        recoveredAt: new Date().toISOString(),
        downtimeMs: null,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'network:event', payload: netEvent });
      res.json({ restored: true, devices });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- MQTT QOS LABORATORY ROUTES ---

  app.get('/api/qos/experiments', (_req, res) => {
    res.json(db.getQosExperiments(30));
  });

  app.post('/api/qos/run', requireApiKeyIfConfigured, async (req, res) => {
    try {
      const qos = Number(req.body?.qos);
      if (![0, 1, 2].includes(qos)) {
        res.status(400).json({ error: 'QoS must be 0, 1, or 2.' });
        return;
      }
      const messageCount = Number(req.body?.messageCount ?? 20);
      const simulatedDelayMs = Number(req.body?.simulatedDelayMs ?? 0);
      const packetLossPct = Number(req.body?.packetLossPct ?? 0);
      const simulateDuplicateResend = Boolean(req.body?.simulateDuplicateResend);

      const result = await networkEngine.runQosExperiment({
        qos: qos as MqttQoS,
        messageCount,
        simulatedDelayMs,
        packetLossPct,
        simulateDuplicateResend,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // --- ALERTS, ANALYTICS & SETTINGS ROUTES ---

  app.get('/api/alerts', (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    res.json(db.getAlerts(limit));
  });

  app.post('/api/alerts/:id/ack', requireApiKeyIfConfigured, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid alert ID.' });
      return;
    }
    const updated = db.acknowledgeAlert(id);
    if (!updated) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }
    broadcast({ type: 'alert:updated', payload: updated });
    res.json(updated);
  });

  app.get('/api/readings', (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    res.json(db.getRecentReadings(limit, deviceId));
  });

  app.get('/api/mqtt/events', (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    res.json(db.getRecentMqttEvents(limit));
  });

  app.get('/api/network/events', (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    res.json(db.getRecentNetworkEvents(limit));
  });

  app.get('/api/settings', (_req, res) => {
    res.json(networkEngine.getThresholds());
  });

  app.put('/api/settings', requireApiKeyIfConfigured, (req, res) => {
    const updated = networkEngine.updateThresholds(req.body ?? {});
    res.json(updated);
  });

  app.post('/api/settings/clear-history', requireApiKeyIfConfigured, (_req, res) => {
    db.clearTelemetryHistory();
    res.json({ cleared: true });
  });

  // --- WEBSOCKET UPGRADE WITH ORIGIN/PATH VALIDATION ---

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname !== '/ws') {
      return;
    }

    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        const allowed =
          originHost === host ||
          originHost.startsWith('localhost') ||
          originHost.startsWith('127.0.0.1') ||
          originHost.endsWith('.run.app');
        if (!allowed) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    const initEvent: WsServerEvent = {
      type: 'init',
      payload: networkEngine.getSnapshot(),
    };
    ws.send(JSON.stringify(initEvent));
  });

  // --- VITE DEV MIDDLEWARE OR PRODUCTION STATIC DIST ---
  if (options?.attachVite !== false) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
          next();
          return;
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const shutdown = async () => {
    for (const client of wss.clients) {
      client.close();
    }
    wss.close();
    await deviceManager.shutdown();
    await networkEngine.shutdown();
    await broker.shutdown();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    db.close();
  };

  return {
    app,
    httpServer,
    wss,
    broker,
    db,
    deviceManager,
    networkEngine,
    shutdown,
  };
}

// Start server when executed directly as main entry point
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMainModule) {
  createHydroServer()
    .then(({ httpServer, broker, shutdown }) => {
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(
          `[Virtual Smart Hydro Alert Network] HTTP/WS listening on http://0.0.0.0:${PORT}`
        );
        console.log(
          `[MQTT Broker] ${broker.mode === 'embedded' ? 'Embedded Aedes' : 'External'} TCP MQTT 3.1.1 active on ${broker.host}:${broker.port}`
        );
      });

      const handleSignal = async () => {
        console.log('\nGracefully shutting down Virtual Smart Hydro Alert Network...');
        await shutdown();
        process.exit(0);
      };

      process.once('SIGINT', handleSignal);
      process.once('SIGTERM', handleSignal);
    })
    .catch((err) => {
      console.error('Failed to start Virtual Smart Hydro Alert Network:', err);
      process.exit(1);
    });
}
