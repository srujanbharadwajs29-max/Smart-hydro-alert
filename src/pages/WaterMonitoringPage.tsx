import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ConnectionStatusLabel, WaterStateLabel, formatTime } from '../components/StatusText';
import { hydroApi } from '../lib/api';
import type { SystemStatusSnapshot, WaterScenario, WaterState } from '../types/hydro';

const SIX_SCENARIOS: Array<{
  scenario: WaterScenario;
  state: WaterState;
  label: string;
  summary: string;
}> = [
  {
    scenario: 'NORMAL_IDLE',
    state: 'NORMAL',
    label: '1. Normal Idle',
    summary: 'Zero flow, no surface moisture, nominal standby state.',
  },
  {
    scenario: 'NORMAL_USAGE',
    state: 'NORMAL_FLOW',
    label: '2. Normal Water Usage',
    summary: 'Active flow (~5.4 L/min) with occupant presence detected.',
  },
  {
    scenario: 'UNATTENDED_FLOW',
    state: 'WARNING',
    label: '3. Unattended Water Flow',
    summary: 'Active flow without presence exceeding warning window.',
  },
  {
    scenario: 'CONTINUOUS_WASTAGE',
    state: 'ALERT',
    label: '4. Continuous Water Wastage',
    summary: 'Sustained unattended flow (~10.5 L/min) past alert threshold.',
  },
  {
    scenario: 'WATER_CONTACT_NO_FLOW',
    state: 'LEAK',
    label: '5. Water Contact (No Flow)',
    summary: 'Surface moisture sensor triggered without measurable line flow.',
  },
  {
    scenario: 'CRITICAL_LEAKAGE',
    state: 'CRITICAL',
    label: '6. Critical Leakage Condition',
    summary: 'High-volume pipe burst (>18 L/min) with active moisture contact.',
  },
];

export function WaterMonitoringPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { devices, recentReadings, thresholds } = snapshot;
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(devices[0]?.id ?? 'device00');
  const [busyScenario, setBusyScenario] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? devices[0];

  const deviceReadings = recentReadings
    .filter((r) => !selectedDevice || r.deviceId === selectedDevice.id)
    .slice(0, 30)
    .reverse()
    .map((r) => ({
      time: formatTime(r.receivedAt),
      flowRate: r.flowRate,
      state: r.sensorState,
    }));

  const totalConsumption = devices.reduce((sum, d) => sum + d.totalConsumptionLiters, 0);
  const totalWastage = devices.reduce((sum, d) => sum + d.estimatedWastageLiters, 0);

  const handleRunScenario = async (scenario: WaterScenario) => {
    if (!selectedDevice) return;
    setBusyScenario(scenario);
    setFeedback(null);
    try {
      await hydroApi.triggerScenario(selectedDevice.id, scenario);
      setFeedback(`Triggered ${scenario.replace(/_/g, ' ')} on ${selectedDevice.name} via MQTT.`);
    } catch (err) {
      setFeedback((err as Error).message);
    } finally {
      setBusyScenario(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Water Intelligence Engine
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Evaluates six preserved operational states (NORMAL, NORMAL_FLOW, WARNING, ALERT, LEAK, CRITICAL) from software-generated sensor streams published over MQTT.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          Software-generated telemetry · No physical sensors attached
        </div>
      </div>

      {/* Water KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Consumption</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {totalConsumption.toFixed(2)} <span className="text-xs font-normal text-slate-500">L</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Cumulative across all nodes</div>
        </div>
        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Estimated Wastage</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {totalWastage.toFixed(2)} <span className="text-xs font-normal text-slate-500">L</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Attributed to WARNING/ALERT/LEAK/CRITICAL</div>
        </div>
        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Unattended Thresholds</div>
          <div className="mt-2 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {thresholds.warningUnattendedSec}s / {thresholds.alertWastageSec}s
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Warning / Alert escalation windows</div>
        </div>
        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Critical Flow Threshold</div>
          <div className="mt-2 font-mono text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
            {thresholds.criticalFlowThresholdLpm.toFixed(1)} L/min
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active flow gate: {thresholds.flowActiveThresholdLpm} L/min
          </div>
        </div>
      </section>

      {/* Repeatable 6-State Scenario Simulator */}
      <section className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Six-State Demonstration Scenarios
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select a virtual sensor node and trigger any deterministic water condition to verify live MQTT alert classification.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="water-device-select" className="text-xs text-slate-500 dark:text-slate-400">
              Target Device:
            </label>
            <select
              id="water-device-select"
              value={selectedDevice?.id ?? ''}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.sensorState})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {SIX_SCENARIOS.map((item) => {
            const isActive = selectedDevice?.scenario === item.scenario;
            return (
              <button
                key={item.scenario}
                type="button"
                disabled={busyScenario !== null || !selectedDevice}
                onClick={() => handleRunScenario(item.scenario)}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  isActive
                    ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.label}
                  </span>
                  <WaterStateLabel state={item.state} />
                </div>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.summary}
                </p>
              </button>
            );
          })}
        </div>

        {feedback && (
          <div className="text-xs text-sky-700 dark:text-sky-300 font-medium">{feedback}</div>
        )}
      </section>

      {/* Selected Device Telemetry Chart & Current Readings */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Flow Rate History — {selectedDevice?.name ?? 'All Devices'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {selectedDevice?.sensorTopic}
              </p>
            </div>
            {selectedDevice && <WaterStateLabel state={selectedDevice.sensorState} />}
          </div>
          <div className="h-64">
            {deviceReadings.length < 2 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Waiting for MQTT sensor readings on this device...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={deviceReadings}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={36} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f1f5f9',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="flowRate"
                    name="Flow Rate (L/min)"
                    stroke="#0284c7"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Selected Node Telemetry
          </h2>
          {selectedDevice ? (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Connection Status</dt>
                <dd><ConnectionStatusLabel status={selectedDevice.connectionStatus} /></dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Water State</dt>
                <dd><WaterStateLabel state={selectedDevice.sensorState} /></dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Current Flow Rate</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {selectedDevice.flowRate.toFixed(2)} L/min
                </dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Occupant Presence</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {selectedDevice.presenceDetected ? 'DETECTED' : 'NONE'}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Moisture Contact</dt>
                <dd
                  className={`font-mono ${
                    selectedDevice.waterDetected
                      ? 'text-red-600 dark:text-red-400 font-semibold'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {selectedDevice.waterDetected ? 'WATER DETECTED' : 'DRY'}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Unattended Duration</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {Math.round(selectedDevice.unattendedFlowSeconds)} s
                </dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Node Consumption</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {selectedDevice.totalConsumptionLiters.toFixed(3)} L
                </dd>
              </div>
              <div className="py-2.5 flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Node Est. Wastage</dt>
                <dd className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                  {selectedDevice.estimatedWastageLiters.toFixed(3)} L
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">No device selected.</p>
          )}
        </div>
      </section>

      {/* Historical Readings Table */}
      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recent Software-Simulated Sensor Readings
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Received</th>
                <th className="py-2.5 px-4 font-medium">Device</th>
                <th className="py-2.5 px-4 font-medium">State</th>
                <th className="py-2.5 px-4 font-medium text-right">Flow (L/min)</th>
                <th className="py-2.5 px-4 font-medium">Presence</th>
                <th className="py-2.5 px-4 font-medium">Moisture</th>
                <th className="py-2.5 px-4 font-medium text-right">Receipt Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {recentReadings.slice(0, 15).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-500">
                    {formatTime(r.receivedAt)}
                  </td>
                  <td className="py-2 px-4 font-medium text-slate-900 dark:text-slate-100">
                    {r.deviceName}
                  </td>
                  <td className="py-2 px-4">
                    <WaterStateLabel state={r.sensorState} />
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {r.flowRate.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-600 dark:text-slate-300">
                    {r.presenceDetected ? 'YES' : 'NO'}
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-600 dark:text-slate-300">
                    {r.waterDetected ? 'WET' : 'DRY'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {r.backendReceiptMs.toFixed(2)} ms
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
