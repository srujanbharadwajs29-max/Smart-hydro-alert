import { useState, type FormEvent } from 'react';
import { Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import { ConnectionStatusLabel, WaterStateLabel, formatTime } from '../components/StatusText';
import { hydroApi } from '../lib/api';
import type { MqttQoS, SystemStatusSnapshot, VirtualDevice } from '../types/hydro';

export function VirtualDeviceLabPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { devices, thresholds } = snapshot;
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [zone, setZone] = useState('');
  const [qos, setQos] = useState<MqttQoS>(1);
  const [intervalMs, setIntervalMs] = useState(thresholds.defaultPublishIntervalMs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddDevice = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !location.trim()) {
      setError('Please enter both a device name and location.');
      return;
    }
    setBusyId('create');
    try {
      await hydroApi.addDevice({
        name: name.trim(),
        location: location.trim(),
        zone: zone.trim() || undefined,
        qos,
        publishIntervalMs: intervalMs,
      });
      setName('');
      setLocation('');
      setZone('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusyId(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const triggerAbnormal = (dev: VirtualDevice) =>
    runAction(`abn-${dev.id}`, () =>
      hydroApi.triggerScenario(
        dev.id,
        dev.sensorState === 'LEAK' ? 'CRITICAL_LEAKAGE' : 'WATER_CONTACT_NO_FLOW'
      )
    );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Virtual Device Simulation Lab
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Each node runs as an independent TCP MQTT client publishing to its own topic hierarchy with Last Will & Testament enabled. Capacity: {devices.length} / {thresholds.maxDevices} devices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => runAction('start-all', () => hydroApi.startAllDevices())}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            Start All
          </button>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => runAction('stop-all', () => hydroApi.stopAllDevices())}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Square className="w-3.5 h-3.5" />
            Stop All
          </button>
        </div>
      </div>

      {/* Add Virtual Device Form */}
      <form
        onSubmit={handleAddDevice}
        className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
      >
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Provision New Virtual MQTT Device
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="lg:col-span-2">
            <label htmlFor="dev-name" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              Device Name
            </label>
            <input
              id="dev-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Floor 5 Device"
              className="w-full px-3 py-2 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="lg:col-span-2">
            <label htmlFor="dev-loc" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              Location
            </label>
            <input
              id="dev-loc"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Building 1 · Floor 5 Pantry"
              className="w-full px-3 py-2 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="dev-qos" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              QoS / Interval (ms)
            </label>
            <div className="flex gap-1.5">
              <select
                id="dev-qos"
                value={qos}
                onChange={(e) => setQos(Number(e.target.value) as MqttQoS)}
                className="w-16 px-2 py-2 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono"
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
              <input
                type="number"
                min={500}
                max={30000}
                step={250}
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="w-full px-2 py-2 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono tabular-nums"
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={busyId === 'create' || devices.length >= thresholds.maxDevices}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Device
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </form>

      {/* Devices Table */}
      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Device & MQTT Topic</th>
                <th className="py-3 px-3 font-medium">Status</th>
                <th className="py-3 px-3 font-medium">State & Sensors</th>
                <th className="py-3 px-3 font-medium text-right">Flow (L/min)</th>
                <th className="py-3 px-3 font-medium text-right">Interval / QoS</th>
                <th className="py-3 px-3 font-medium text-right">Msgs / Last Seen</th>
                <th className="py-3 px-4 font-medium text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {devices.map((dev) => (
                <tr key={dev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {dev.name}{' '}
                      <span className="font-mono text-slate-400 font-normal">({dev.id})</span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">{dev.location}</div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {dev.sensorTopic}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <ConnectionStatusLabel status={dev.connectionStatus} />
                    <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                      {dev.clientId}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <WaterStateLabel state={dev.sensorState} />
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                      Pres: {dev.presenceDetected ? 'Y' : 'N'} · Wet: {dev.waterDetected ? 'Y' : 'N'}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {dev.flowRate.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <select
                        aria-label={`Publish interval for ${dev.name}`}
                        value={dev.publishIntervalMs}
                        onChange={(e) =>
                          runAction(`int-${dev.id}`, () =>
                            hydroApi.updateDeviceConfig(dev.id, {
                              publishIntervalMs: Number(e.target.value),
                            })
                          )
                        }
                        className="px-1.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                      >
                        <option value={1000}>1.0s</option>
                        <option value={2000}>2.0s</option>
                        <option value={2500}>2.5s</option>
                        <option value={3000}>3.0s</option>
                        <option value={5000}>5.0s</option>
                        <option value={10000}>10s</option>
                      </select>
                      <select
                        aria-label={`QoS for ${dev.name}`}
                        value={dev.qos}
                        onChange={(e) =>
                          runAction(`qos-${dev.id}`, () =>
                            hydroApi.updateDeviceConfig(dev.id, {
                              qos: Number(e.target.value) as MqttQoS,
                            })
                          )
                        }
                        className="px-1.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                      >
                        <option value={0}>Q0</option>
                        <option value={1}>Q1</option>
                        <option value={2}>Q2</option>
                      </select>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                    <div className="text-slate-800 dark:text-slate-200">{dev.messagesPublished}</div>
                    <div className="text-[11px] text-slate-400">
                      {formatTime(dev.lastCommunicationAt)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      {dev.isRunning ? (
                        <button
                          type="button"
                          onClick={() => runAction(`stop-${dev.id}`, () => hydroApi.stopDevice(dev.id))}
                          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => runAction(`start-${dev.id}`, () => hydroApi.startDevice(dev.id))}
                          className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          Start
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => runAction(`restart-${dev.id}`, () => hydroApi.restartDevice(dev.id))}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Restart
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(`norm-${dev.id}`, () =>
                            hydroApi.triggerScenario(dev.id, 'NORMAL_USAGE')
                          )
                        }
                        className="px-2 py-1 rounded border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40"
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerAbnormal(dev)}
                        className="px-2 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        Abnormal
                      </button>
                      <button
                        type="button"
                        title="Reset counters & scenario"
                        onClick={() => runAction(`reset-${dev.id}`, () => hydroApi.resetDevice(dev.id))}
                        className="p-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        title="Remove virtual device"
                        onClick={() => runAction(`del-${dev.id}`, () => hydroApi.removeDevice(dev.id))}
                        className="p-1.5 rounded border border-slate-300 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
