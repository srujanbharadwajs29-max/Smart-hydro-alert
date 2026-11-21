import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTime } from '../components/StatusText';
import { hydroApi } from '../lib/api';
import type { MqttQoS, SystemStatusSnapshot } from '../types/hydro';

export function QosLabPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { qosExperiments } = snapshot;
  const [qos, setQos] = useState<MqttQoS>(1);
  const [messageCount, setMessageCount] = useState(25);
  const [simulatedDelayMs, setSimulatedDelayMs] = useState(0);
  const [packetLossPct, setPacketLossPct] = useState(0);
  const [simulateDuplicateResend, setSimulateDuplicateResend] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunTest = async () => {
    setRunning(true);
    setError(null);
    try {
      await hydroApi.runQosExperiment({
        qos,
        messageCount,
        simulatedDelayMs,
        packetLossPct,
        simulateDuplicateResend: qos === 1 && simulateDuplicateResend,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleRunAllComparison = async () => {
    setRunning(true);
    setError(null);
    try {
      for (const level of [0, 1, 2] as MqttQoS[]) {
        await hydroApi.runQosExperiment({
          qos: level,
          messageCount: Math.min(messageCount, 30),
          simulatedDelayMs,
          packetLossPct,
          simulateDuplicateResend: level === 1 && simulateDuplicateResend,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const latestByQos = ([0, 1, 2] as MqttQoS[]).map((level) => {
    const match = qosExperiments.find((e) => e.qos === level);
    return {
      name: `QoS ${level}`,
      avgBrokerAckMs: match?.avgBrokerAckMs ?? 0,
      avgDeliveryMs: match?.avgDeliveryMs ?? 0,
      deliveryRatePct: match
        ? Number(((match.receivedCount / Math.max(1, match.messageCount)) * 100).toFixed(1))
        : 0,
      duplicates: match?.duplicateCount ?? 0,
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            MQTT Quality of Service (QoS) Laboratory
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Execute real TCP MQTT publish/subscribe trials comparing QoS 0, QoS 1, and QoS 2 handshake overhead, acknowledgements, latency, and delivery semantics.
          </p>
        </div>
      </div>

      {/* Experiment Runner */}
      <section className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">QoS Level</div>
            <div className="flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {([0, 1, 2] as MqttQoS[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setQos(level)}
                  className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
                    qos === level
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  QoS {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="qos-count" className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
              Message Count (1–100)
            </label>
            <input
              id="qos-count"
              type="number"
              min={1}
              max={100}
              value={messageCount}
              onChange={(e) => setMessageCount(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="qos-delay" className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
              Inter-Message Delay (ms)
            </label>
            <input
              id="qos-delay"
              type="number"
              min={0}
              max={200}
              step={5}
              value={simulatedDelayMs}
              onChange={(e) => setSimulatedDelayMs(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="qos-loss" className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
              Simulated Drop % (0–50)
            </label>
            <input
              id="qos-loss"
              type="number"
              min={0}
              max={50}
              step={5}
              value={packetLossPct}
              onChange={(e) => setPacketLossPct(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={running}
              onClick={handleRunTest}
              className="flex-1 px-4 py-2 text-xs font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {running ? 'Running...' : `Run QoS ${qos}`}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={handleRunAllComparison}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              Run 0/1/2
            </button>
          </div>
        </div>

        {qos === 1 && (
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={simulateDuplicateResend}
              onChange={(e) => setSimulateDuplicateResend(e.target.checked)}
              className="rounded border-slate-400"
            />
            Simulate unacknowledged retransmit every 5th message (demonstrates QoS 1 at-least-once duplicate delivery)
          </label>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </section>

      {/* Protocol Handshake Reference & Accuracy Clarification */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              QoS 0 — At Most Once
            </h3>
            <span className="font-mono text-xs text-slate-500">1 Packet</span>
          </div>
          <div className="font-mono text-xs text-sky-600 dark:text-sky-400">
            Client --[PUBLISH]--&gt; Broker
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Fire-and-forget delivery relying only on TCP. No MQTT acknowledgement frame is sent; lowest latency, but packets dropped prior to delivery are never retried.
          </p>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              QoS 1 — At Least Once
            </h3>
            <span className="font-mono text-xs text-slate-500">2 Packets</span>
          </div>
          <div className="font-mono text-xs text-amber-600 dark:text-amber-400">
            PUBLISH --&gt; PUBACK
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Sender stores the message until it receives PUBACK from the broker. If PUBACK is lost, the sender retransmits with DUP=1, which can produce duplicate deliveries.
          </p>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              QoS 2 — Exactly Once (MQTT Layer)
            </h3>
            <span className="font-mono text-xs text-slate-500">4 Packets</span>
          </div>
          <div className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
            PUBLISH --&gt; PUBREC --&gt; PUBREL --&gt; PUBCOMP
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Four-part handshake guarantees no duplicates at the MQTT protocol delivery level. Note: this does not replace application-level idempotency across backend crashes or database rollbacks.
          </p>
        </div>
      </section>

      {/* Comparison Chart */}
      <section className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Latest QoS 0 vs QoS 1 vs QoS 2 Latency Comparison
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Compares measured Client-&gt;Broker ACK time vs end-to-end subscriber receipt time (same-host monotonic clock)
          </p>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={latestByQos}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} />
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
              <Bar dataKey="avgBrokerAckMs" name="Avg Broker ACK (ms)" fill="#0284c7" radius={[4, 4, 0, 0]} />
              <Bar dataKey="avgDeliveryMs" name="Avg Subscriber Delivery (ms)" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Historical QoS Runs Table */}
      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Persisted QoS Experiment Results ({qosExperiments.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Completed</th>
                <th className="py-2.5 px-3 font-medium">QoS</th>
                <th className="py-2.5 px-3 font-medium text-right">Sent / Ack / Recv</th>
                <th className="py-2.5 px-3 font-medium text-right">Failed</th>
                <th className="py-2.5 px-3 font-medium text-right">Duplicates</th>
                <th className="py-2.5 px-3 font-medium text-right">Broker ACK (avg/max)</th>
                <th className="py-2.5 px-4 font-medium text-right">Sub Delivery (avg/max)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {qosExperiments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No QoS experiments executed yet. Click &ldquo;Run 0/1/2&rdquo; above to benchmark all three levels.
                  </td>
                </tr>
              ) : (
                qosExperiments.map((exp) => (
                  <tr key={exp.runId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">
                      {formatTime(exp.completedAt)}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                      QoS {exp.qos}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {exp.publishedCount} / {exp.acknowledgedCount} / {exp.receivedCount}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                        exp.failedCount > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {exp.failedCount}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                        exp.duplicateCount > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {exp.duplicateCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {exp.avgBrokerAckMs.toFixed(2)} / {exp.maxBrokerAckMs.toFixed(2)} ms
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {exp.avgDeliveryMs.toFixed(2)} / {exp.maxDeliveryMs.toFixed(2)} ms
                    </td>
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
