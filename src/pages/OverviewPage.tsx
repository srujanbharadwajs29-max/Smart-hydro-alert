import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ConnectionStatusLabel, WaterStateLabel, formatTime } from '../components/StatusText';
import type { SystemStatusSnapshot } from '../types/hydro';

interface OverviewPageProps {
  snapshot: SystemStatusSnapshot;
  onNavigate: (page: string) => void;
}

export function OverviewPage({ snapshot, onNavigate }: OverviewPageProps) {
  const { devices, analytics, broker, recentAlerts, recentNetworkEvents } = snapshot;

  const activeDevices = devices.filter((d) => d.connectionStatus === 'CONNECTED').length;
  const offlineDevices = devices.filter(
    (d) =>
      d.connectionStatus === 'DISCONNECTED' ||
      d.connectionStatus === 'RECONNECTING' ||
      d.connectionStatus === 'STOPPED' ||
      d.connectionStatus === 'SILENT'
  ).length;
  const totalFlowRate = devices
    .filter((d) => d.connectionStatus === 'CONNECTED')
    .reduce((sum, d) => sum + d.flowRate, 0);
  const unackAlerts = recentAlerts.filter((a) => !a.acknowledged).length;

  const worstState = (() => {
    const priority = ['CRITICAL', 'LEAK', 'ALERT', 'WARNING', 'NORMAL_FLOW', 'NORMAL'] as const;
    for (const s of priority) {
      if (devices.some((d) => d.sensorState === s)) return s;
    }
    return 'NORMAL' as const;
  })();

  const chartData = analytics.history.slice(-30);

  return (
    <div className="space-y-8">
      {/* Header summary */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Network Operations Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Real-time telemetry from {devices.length} virtual MQTT sensor clients connected over TCP to{' '}
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {broker.host}:{broker.port}
            </span>
            . All sensor readings are software-generated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('devices')}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Manage Virtual Devices
          </button>
          <button
            type="button"
            onClick={() => onNavigate('topology')}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
          >
            Inspect Live Topology
          </button>
        </div>
      </div>

      {/* Primary KPI Grid (Single-level elevation, hairline dividers) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Active / Offline Devices</div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {activeDevices}
            </span>
            <span className="text-sm text-slate-400">/</span>
            <span
              className={`text-lg font-medium ${
                offlineDevices > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {offlineDevices} offline
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {analytics.silentClients > 0
              ? `${analytics.silentClients} silent · ${broker.connectedClients.length} broker sessions`
              : `${broker.connectedClients.length} active broker TCP sessions`}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Aggregate Water Flow</div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {totalFlowRate.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">L/min</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Highest state:</span>
            <WaterStateLabel state={worstState} />
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">MQTT Traffic & Rate</div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {analytics.totalPublished.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">msgs</span>
          </div>
          <div className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {analytics.messagesPerSecond} msg/s · {analytics.totalReceived.toLocaleString()} received
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Broker Status & Avg Latency
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span
              className={`text-lg font-semibold ${
                broker.status === 'ONLINE'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {broker.status}
            </span>
            <span className="font-mono text-sm tabular-nums text-slate-800 dark:text-slate-200">
              {analytics.latency.backendReceipt.avgMs.toFixed(2)} ms
            </span>
          </div>
          <div className="mt-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Receipt avg · {unackAlerts} active alerts · {broker.availabilityPct}% avail
          </div>
        </div>
      </section>

      {/* Dual Charts: Real-Time Message Rate & Aggregate Flow Rate */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Live MQTT Message Throughput
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Actual published packets per second observed by broker
              </p>
            </div>
            <span className="font-mono text-xs tabular-nums text-sky-600 dark:text-sky-400">
              {analytics.messagesPerSecond} msg/s
            </span>
          </div>
          <div className="h-56">
            {chartData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Collecting live MQTT samples...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="msgRateFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0284c7" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={32} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f1f5f9',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="messagesPerSec"
                    name="Messages / sec"
                    stroke="#0284c7"
                    strokeWidth={2}
                    fill="url(#msgRateFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Aggregate Water Flow Rate
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Combined L/min across connected virtual water nodes (software-simulated)
              </p>
            </div>
            <span className="font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
              {totalFlowRate.toFixed(2)} L/min
            </span>
          </div>
          <div className="h-56">
            {chartData.length < 2 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Collecting flow rate history...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={24} />
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
                  <Area
                    type="monotone"
                    dataKey="totalFlowRateLpm"
                    name="Total Flow (L/min)"
                    stroke="#16a34a"
                    strokeWidth={2}
                    fill="url(#flowFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* Fleet Status Table + Recent Network Events */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Virtual Sensor Fleet Summary
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('water')}
              className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
            >
              Open Water Monitoring
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Device</th>
                  <th className="py-2.5 px-4 font-medium">Connection</th>
                  <th className="py-2.5 px-4 font-medium">Water State</th>
                  <th className="py-2.5 px-4 font-medium text-right">Flow (L/min)</th>
                  <th className="py-2.5 px-4 font-medium text-right">QoS</th>
                  <th className="py-2.5 px-4 font-medium text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">
                {devices.map((dev) => (
                  <tr
                    key={dev.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{dev.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {dev.sensorTopic}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <ConnectionStatusLabel status={dev.connectionStatus} />
                    </td>
                    <td className="py-2.5 px-4">
                      <WaterStateLabel state={dev.sensorState} />
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {dev.flowRate.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {dev.qos}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {formatTime(dev.lastCommunicationAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Network Events
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('failures')}
              className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
            >
              Failure Lab
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70 overflow-y-auto max-h-80">
            {recentNetworkEvents.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No network failure or recovery events logged yet. Inject a fault in the Network Failure Simulator to observe live detection.
              </div>
            ) : (
              recentNetworkEvents.slice(0, 8).map((ev) => (
                <div key={ev.id} className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-medium ${
                        ev.severity === 'CRITICAL'
                          ? 'text-red-600 dark:text-red-400'
                          : ev.severity === 'WARNING'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {ev.eventType.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {formatTime(ev.createdAt)}
                    </span>
                  </div>
                  <div className="text-slate-700 dark:text-slate-300">{ev.targetName}</div>
                  <div className="text-slate-500 dark:text-slate-400 leading-relaxed">
                    {ev.details}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
