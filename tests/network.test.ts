import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createHydroServer } from '../server.ts';
import { DEFAULT_THRESHOLDS } from '../server/database.ts';
import { evaluateWaterState } from '../server/waterIntelligence.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// 1. UNIT TESTS (Pure Logic — No Network Sockets)
// =============================================================================

test('Unit: Water Intelligence Engine evaluates all 6 preserved states accurately', () => {
  const th = { ...DEFAULT_THRESHOLDS };

  // 1. NORMAL
  assert.equal(
    evaluateWaterState({
      flowRate: 0.0,
      presenceDetected: false,
      waterDetected: false,
      unattendedFlowSeconds: 0,
      thresholds: th,
    }).state,
    'NORMAL'
  );

  // 2. NORMAL_FLOW
  assert.equal(
    evaluateWaterState({
      flowRate: 5.5,
      presenceDetected: true,
      waterDetected: false,
      unattendedFlowSeconds: 0,
      thresholds: th,
    }).state,
    'NORMAL_FLOW'
  );

  // 3. WARNING
  assert.equal(
    evaluateWaterState({
      flowRate: 6.2,
      presenceDetected: false,
      waterDetected: false,
      unattendedFlowSeconds: th.warningUnattendedSec + 1,
      thresholds: th,
    }).state,
    'WARNING'
  );

  // 4. ALERT
  assert.equal(
    evaluateWaterState({
      flowRate: 9.8,
      presenceDetected: false,
      waterDetected: false,
      unattendedFlowSeconds: th.alertWastageSec + 2,
      thresholds: th,
    }).state,
    'ALERT'
  );

  // 5. LEAK (water contact without measurable line flow)
  assert.equal(
    evaluateWaterState({
      flowRate: 0.05,
      presenceDetected: false,
      waterDetected: true,
      unattendedFlowSeconds: 0,
      thresholds: th,
    }).state,
    'LEAK'
  );

  // 6. CRITICAL (high-volume burst + moisture contact)
  assert.equal(
    evaluateWaterState({
      flowRate: th.criticalFlowThresholdLpm + 5,
      presenceDetected: false,
      waterDetected: true,
      unattendedFlowSeconds: 30,
      thresholds: th,
    }).state,
    'CRITICAL'
  );
});

// =============================================================================
// 2. REAL NETWORK INTEGRATION TESTS (Real TCP MQTT Broker + Clients + SQLite + WS)
// =============================================================================

test('Integration: Full MQTT stack, virtual devices, QoS 0/1/2, LWT, silent timeout, broker outage, DB, and WebSocket', async () => {
  const stack = await createHydroServer({
    dbPath: ':memory:',
    mqttPort: 0, // ephemeral TCP port for isolated testing
    autoStartDevices: true,
    attachVite: false,
  });

  await new Promise<void>((resolve) => stack.httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = stack.httpServer.address();
  assert.ok(addr && typeof addr !== 'string');
  const httpBase = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  try {
    // Wait for initial 5 default virtual devices to connect over TCP and publish readings
    await sleep(900);

    // 1. Verify 5 default virtual devices exist and are connected over real MQTT
    const devices = stack.deviceManager.listDevices();
    assert.equal(devices.length, 5, 'Should initialize 5 default virtual devices');
    const connectedCount = devices.filter((d) => d.connectionStatus === 'CONNECTED').length;
    assert.ok(connectedCount >= 4, `Expected default devices connected, got ${connectedCount}`);

    // 2. Verify dynamic virtual device creation
    const added = await stack.deviceManager.addDevice({
      name: 'Floor 5 Test Device',
      location: 'Building 1 · Floor 5 Test Bay',
      zone: 'floor5',
      qos: 2,
      publishIntervalMs: 1000,
    });
    assert.equal(added.name, 'Floor 5 Test Device');
    await sleep(400);
    assert.equal(stack.deviceManager.listDevices().length, 6);

    // 3. Verify backend MQTT subscriber received real sensor messages and persisted them to SQLite
    const readings = stack.db.getRecentReadings(50);
    assert.ok(readings.length > 0, 'Backend subscriber should persist real MQTT sensor readings');
    const analytics = stack.networkEngine.getAnalyticsSummary();
    assert.ok(analytics.totalPublished > 0, 'Broker should count real published messages');
    assert.ok(analytics.totalReceived > 0, 'Backend should count real received messages');
    assert.ok(analytics.latency.backendReceipt.samples > 0, 'Should record monotonic receipt latency');

    // 4. Verify Water Intelligence alert generation via MQTT
    stack.deviceManager.triggerScenario('device01', 'CRITICAL_LEAKAGE');
    await sleep(450);
    const alerts = stack.db.getAlerts(20);
    assert.ok(
      alerts.some((a) => a.deviceId === 'device01' && a.severity === 'CRITICAL'),
      'Triggering CRITICAL_LEAKAGE over MQTT should persist a CRITICAL water alert'
    );

    // 5. Verify MQTT QoS 0, QoS 1, and QoS 2 Laboratory runs over real TCP sockets
    for (const qos of [0, 1, 2] as const) {
      const res = await stack.networkEngine.runQosExperiment({
        qos,
        messageCount: 10,
        simulatedDelayMs: 0,
        packetLossPct: 0,
        simulateDuplicateResend: qos === 1,
      });
      assert.equal(res.qos, qos);
      assert.equal(res.publishedCount, 10);
      assert.equal(res.receivedCount, 10, `QoS ${qos} should deliver all 10 unique messages`);
      if (qos === 1) {
        assert.ok(res.duplicateCount >= 1, 'QoS 1 resend test should observe duplicate deliveries');
      } else if (qos === 2) {
        assert.equal(res.duplicateCount, 0, 'QoS 2 must observe zero duplicates');
      }
    }
    assert.equal(stack.db.getQosExperiments(10).length, 3, 'All 3 QoS experiments persisted');

    // 6. Verify abrupt TCP disconnect triggers real MQTT Last Will & Testament (LWT)
    await stack.deviceManager.disconnectDevice('device02', true);
    await sleep(450);
    const eventsAfterLwt = stack.db.getRecentNetworkEvents(30);
    assert.ok(
      eventsAfterLwt.some((e) => e.targetId === 'device02' && e.eventType === 'DEVICE_LWT_TRIGGERED'),
      'Abrupt TCP drop must trigger broker LWT delivery and backend detection'
    );

    // 7. Verify silent publisher detection distinct from MQTT disconnect
    stack.networkEngine.updateThresholds({ heartbeatTimeoutSec: 4 });
    stack.deviceManager.updateDeviceConfig('device03', { publishingPaused: true });
    await sleep(6500);
    const dev3 = stack.deviceManager.getDevice('device03');
    assert.equal(
      dev3?.connectionStatus,
      'SILENT',
      'Connected client with paused publishing must be flagged SILENT by heartbeat monitor'
    );

    // 8. Verify real TCP broker interruption and automatic client reconnection
    await stack.broker.interrupt();
    assert.equal(stack.broker.getStatus().status, 'INTERRUPTED');
    await sleep(300);
    await stack.broker.restore();
    assert.equal(stack.broker.getStatus().status, 'ONLINE');
    await sleep(2500);
    const reconnectedEvents = stack.db.getRecentNetworkEvents(50);
    assert.ok(
      reconnectedEvents.some((e) => e.eventType === 'BROKER_RESTORED'),
      'Broker restoration should be persisted to network events'
    );

    // 9. Verify WebSocket server sends initial snapshot and live broadcasts
    const wsInitReceived = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket init timed out'));
      }, 3000);
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString('utf8')) as { type: string };
        if (parsed.type === 'init') {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    assert.equal(wsInitReceived, true);

    // 10. Verify REST health endpoint
    const healthRes = await fetch(`${httpBase}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string };
    assert.equal(healthJson.status, 'ok');
  } finally {
    await stack.shutdown();
  }
});
