import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SystemStatusSnapshot } from '../types/hydro';

export function NetworkAnalyticsPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { analytics, broker } = snapshot;
  const history = analytics.history;

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Network Performance Analytics
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Measured using Node.js monotonic high-resolution clocks (<span className="font-mono">process.hrtime.bigint()</span>) on the local host. Broker acknowledgement, backend receipt, and backend processing latencies are tracked independently.
        </p>
      </div>

      {/* Clearly Separated Latency Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            title: '1. Broker Acknowledgement Time',
            subtitle: 'Client publish call → MQTT PUBACK / PUBCOMP callback',
            stats: analytics.latency.brokerAck,
          },
          {
            title: '2. Backend Receipt Time',
            subtitle: 'Client monotonic publish timestamp → Backend subscriber receipt',
            stats: analytics.latency.backendReceipt,
          },
          {
            title: '3. Backend Processing Time',
            subtitle: 'Subscriber receipt → Water Intelligence eval + SQLite commit',
            stats: analytics.latency.backendProcess,
          },
        ].map((item) => (
          <div
            key={item.title}
            className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {item.title}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</div>
            <div className="pt-2 flex items-baseline gap-4 font-mono tabular-nums">
              <div>
                <div className="text-[11px] text-slate-400">Avg</div>
                <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {item.stats.avgMs.toFixed(2)} ms
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Min</div>
                <div className="text-sm text-emerald-600 dark:text-emerald-400">
                  {item.stats.minMs.toFixed(2)} ms
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Max</div>
                <div className="text-sm text-amber-600 dark:text-amber-400">
                  {item.stats.maxMs.toFixed(2)} ms
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-slate-400">Samples</div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {item.stats.samples}
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Operational Counters */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Messages / sec', value: `${analytics.messagesPerSecond}` },
          { label: 'Throughput', value: `${analytics.throughputBytesPerSecond} B/s` },
          { label: 'Processed OK', value: analytics.successfulProcessing.toLocaleString() },
          { label: 'Failed Proc', value: analytics.failedProcessing.toLocaleString() },
          { label: 'Reconnections', value: analytics.totalReconnections.toLocaleString() },
          { label: 'Broker Availability', value: `${broker.availabilityPct}%` },
        ].map((m) => (
          <div
            key={m.label}
            className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{m.label}</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {m.value}
            </div>
          </div>
        ))}
      </section>

      {/* Latency Breakdown Chart */}
      <section className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Historical Latency Breakdown (ms)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Per-second averages distinguishing broker acknowledgement, backend receipt, and backend processing durations
          </p>
        </div>
        <div className="h-64">
          {history.length < 2 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              Collecting live latency samples...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} unit="ms" width={48} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f1f5f9',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="avgBrokerAckMs"
                  name="Broker ACK (ms)"
                  stroke="#0284c7"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="avgBackendReceiptMs"
                  name="Backend Receipt (ms)"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="avgBackendProcessMs"
                  name="Backend Process (ms)"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Throughput & Client Connectivity Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Payload Throughput (Bytes / sec)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Measured MQTT payload volume routed through the broker
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={46} />
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
                  dataKey="throughputBytesPerSec"
                  name="Bytes / sec"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.2}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Active vs Offline Virtual Clients
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Live client session count tracked across disconnections and recovery
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
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
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="stepAfter"
                  dataKey="activeClients"
                  name="Active Clients"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="offlineClients"
                  name="Offline Clients"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}
