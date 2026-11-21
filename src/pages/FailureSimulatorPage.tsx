import { useState } from 'react';
import { ConnectionStatusLabel, formatTime } from '../components/StatusText';
import { hydroApi } from '../lib/api';
import type { SystemStatusSnapshot } from '../types/hydro';

export function FailureSimulatorPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { devices, broker, recentNetworkEvents, thresholds } = snapshot;
  const [targetDeviceId, setTargetDeviceId] = useState(devices[0]?.id ?? 'device00');
  const [delayMs, setDelayMs] = useState(800);
  const [lossPct, setLossPct] = useState(30);
  const [outageSec, setOutageSec] = useState(8);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedDevice = devices.find((d) => d.id === targetDeviceId) ?? devices[0];

  const run = async (key: string, action: () => Promise<unknown>, successMsg: string) => {
    setBusy(key);
    setFeedback(null);
    try {
      await action();
      setFeedback(successMsg);
    } catch (err) {
      setFeedback((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Network Failure Simulator
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Inject real TCP/MQTT faults against live virtual clients and the local MQTT broker. Observe Last Will &amp; Testament (LWT), heartbeat silent-client detection, and automatic reconnection.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(
              'restore-all',
              () => hydroApi.restoreAllCommunication(),
              'Restored broker, cleared simulated transport faults, and reconnected all virtual devices.'
            )
          }
          className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          Restore All Communication
        </button>
      </div>

      {feedback && (
        <div className="px-4 py-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200">
          {feedback}
        </div>
      )}

      {/* Fault Controls Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Device Disconnection & LWT */}
        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              1. Client Disconnection &amp; Silent Publisher Tests
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Abrupt TCP drop triggers real MQTT Last Will &amp; Testament (LWT). Stopping sensor publishing keeps TCP alive so the heartbeat monitor flags a <span className="font-mono">SILENT</span> client after {thresholds.heartbeatTimeoutSec}s.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="fail-dev" className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
              Target Device:
            </label>
            <select
              id="fail-dev"
              value={selectedDevice?.id ?? ''}
              onChange={(e) => setTargetDeviceId(e.target.value)}
              className="flex-1 px-3 py-2 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.connectionStatus}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={!selectedDevice || busy !== null}
              onClick={() =>
                selectedDevice &&
                run(
                  'disc-abrupt',
                  () => hydroApi.disconnectDevice(selectedDevice.id, true),
                  `Destroyed TCP socket on ${selectedDevice.name} — broker should publish LWT on ${selectedDevice.statusTopic}.`
                )
              }
              className="px-3 py-2 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Abrupt Disconnect (Trigger LWT)
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run(
                  'disc-multi',
                  () =>
                    hydroApi.disconnectMultiple(
                      devices.slice(0, 3).map((d) => d.id),
                      true
                    ),
                  'Abruptly disconnected 3 virtual devices simultaneously.'
                )
              }
              className="px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 transition-colors"
            >
              Disconnect 3 Devices
            </button>

            <button
              type="button"
              disabled={!selectedDevice || busy !== null}
              onClick={() =>
                selectedDevice &&
                run(
                  'pause-pub',
                  () => hydroApi.pausePublishing(selectedDevice.id, !selectedDevice.publishingPaused),
                  selectedDevice.publishingPaused
                    ? `Resumed MQTT publishing on ${selectedDevice.name}.`
                    : `Paused MQTT publishing on ${selectedDevice.name} while keeping TCP connected (wait ${thresholds.heartbeatTimeoutSec}s for SILENT detection).`
                )
              }
              className="px-3 py-2 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50 transition-colors"
            >
              {selectedDevice?.publishingPaused ? 'Resume Publishing' : 'Stop Publishing (Silent Mode)'}
            </button>

            <button
              type="button"
              disabled={!selectedDevice || busy !== null}
              onClick={() =>
                selectedDevice &&
                run(
                  'restart-dev',
                  () => hydroApi.restartDevice(selectedDevice.id),
                  `Restarted virtual MQTT client ${selectedDevice.name}.`
                )
              }
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Restart Virtual Device
            </button>
          </div>
        </div>

        {/* 2. Broker Interruption & Transport Impairment */}
        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              2. Broker Outage &amp; Client Transport Impairment
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Interrupting the embedded broker closes TCP port {broker.port} and forces all clients into real MQTT reconnection loops.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="outage-sec" className="text-xs text-slate-500 dark:text-slate-400">
              Timed Outage (sec):
            </label>
            <input
              id="outage-sec"
              type="number"
              min={3}
              max={60}
              value={outageSec}
              onChange={(e) => setOutageSec(Number(e.target.value))}
              className="w-20 px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
            {broker.status === 'ONLINE' ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null || broker.mode !== 'embedded'}
                  onClick={() =>
                    run(
                      'broker-timed',
                      () => hydroApi.interruptBroker(outageSec),
                      `Interrupted embedded MQTT broker for ${outageSec}s. Watch clients enter RECONNECTING and recover.`
                    )
                  }
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Simulate {outageSec}s Broker Outage
                </button>
                <button
                  type="button"
                  disabled={busy !== null || broker.mode !== 'embedded'}
                  onClick={() =>
                    run(
                      'broker-stop',
                      () => hydroApi.interruptBroker(0),
                      'Stopped embedded MQTT broker until manually restored.'
                    )
                  }
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                >
                  Stop Broker
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run('broker-restore', () => hydroApi.restoreBroker(), 'Restored MQTT TCP broker.')
                }
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Restore Broker Now
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label htmlFor="sim-delay" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Publish Delay (ms)
              </label>
              <input
                id="sim-delay"
                type="number"
                min={0}
                max={10000}
                step={100}
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>
            <div>
              <label htmlFor="sim-loss" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Simulated Drop (%)
              </label>
              <input
                id="sim-loss"
                type="number"
                min={0}
                max={100}
                step={5}
                value={lossPct}
                onChange={(e) => setLossPct(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>
            <button
              type="button"
              disabled={!selectedDevice || busy !== null}
              onClick={() =>
                selectedDevice &&
                run(
                  'impair',
                  () => hydroApi.setDeviceImpairment(selectedDevice.id, delayMs, lossPct),
                  `Applied client-side delay=${delayMs}ms and simulated drop=${lossPct}% on ${selectedDevice.name}.`
                )
              }
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap"
            >
              Apply to Device
            </button>
          </div>
        </div>
      </section>

      {/* Live Device Health Status Table */}
      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Live Node Connectivity &amp; Active Faults
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Device</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Publishing</th>
                <th className="py-2.5 px-3 font-medium text-right">Delay / Drop</th>
                <th className="py-2.5 px-3 font-medium text-right">Reconnects</th>
                <th className="py-2.5 px-4 font-medium text-right">Disconnected At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {devices.map((dev) => (
                <tr key={dev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                    {dev.name}
                  </td>
                  <td className="py-2.5 px-3">
                    <ConnectionStatusLabel status={dev.connectionStatus} />
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                    {dev.publishingPaused ? 'PAUSED' : dev.isRunning ? 'ACTIVE' : 'OFF'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {dev.simulatedDelayMs}ms / {dev.simulatedPacketLossPct}% ({dev.messagesDropped} dropped)
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {dev.reconnectCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                    {formatTime(dev.disconnectedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Persisted Network Failure & Recovery Event Log */}
      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Failure &amp; Recovery Audit Log ({recentNetworkEvents.length})
          </h2>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Timestamp</th>
                <th className="py-2.5 px-3 font-medium">Event</th>
                <th className="py-2.5 px-3 font-medium">Target</th>
                <th className="py-2.5 px-3 font-medium">Detection</th>
                <th className="py-2.5 px-3 font-medium text-right">Downtime</th>
                <th className="py-2.5 px-4 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {recentNetworkEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No failure events recorded yet. Trigger any fault above to verify live detection and logging.
                  </td>
                </tr>
              ) : (
                recentNetworkEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatTime(ev.createdAt)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono font-medium whitespace-nowrap ${
                        ev.severity === 'CRITICAL'
                          ? 'text-red-600 dark:text-red-400'
                          : ev.severity === 'WARNING'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {ev.eventType}
                    </td>
                    <td className="py-2.5 px-3 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {ev.targetName}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {ev.detectionMethod}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {ev.downtimeMs !== null ? `${(ev.downtimeMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{ev.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
