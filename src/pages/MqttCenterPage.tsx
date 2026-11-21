import { useState } from 'react';
import { formatTime } from '../components/StatusText';
import type { MqttEventRecord, SystemStatusSnapshot } from '../types/hydro';

export function MqttCenterPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { broker, analytics, topics, recentMqttEvents } = snapshot;
  const [topicFilter, setTopicFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<MqttEventRecord | null>(
    recentMqttEvents[0] ?? null
  );

  const filteredEvents = recentMqttEvents.filter((ev) => {
    if (!topicFilter.trim()) return true;
    const q = topicFilter.toLowerCase();
    return (
      ev.topic.toLowerCase().includes(q) ||
      ev.clientId.toLowerCase().includes(q) ||
      ev.eventType.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            MQTT Communication Center
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Live protocol telemetry from {broker.mode === 'embedded' ? 'embedded Aedes' : 'external Mosquitto'} TCP broker at{' '}
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {broker.host}:{broker.port}
            </span>{' '}
            ({broker.protocol}). All counters reflect real broker and subscriber events.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          Status:{' '}
          <span
            className={
              broker.status === 'ONLINE'
                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-red-600 dark:text-red-400 font-semibold'
            }
          >
            {broker.status}
          </span>{' '}
          · Auth: {broker.authEnabled ? 'Enabled' : 'Open (Local Lab)'}
        </div>
      </div>

      {/* Live Broker Counters */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Published', value: analytics.totalPublished.toLocaleString() },
          { label: 'Received (Backend)', value: analytics.totalReceived.toLocaleString() },
          { label: 'Broker ACKs', value: analytics.totalAcknowledged.toLocaleString() },
          { label: 'Processing Failures', value: analytics.failedProcessing.toLocaleString() },
          { label: 'Reconnections', value: analytics.totalReconnections.toLocaleString() },
          { label: 'Current Rate', value: `${analytics.messagesPerSecond} msg/s` },
        ].map((item) => (
          <div
            key={item.label}
            className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
            <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {item.value}
            </div>
          </div>
        ))}
      </section>

      {/* Publishers, Subscribers & Active Topic Hierarchy */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Connected MQTT Clients ({broker.connectedClients.length})
          </h2>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">
              Active Publishers ({broker.publishers.length})
            </div>
            <ul className="space-y-1 font-mono text-xs text-slate-800 dark:text-slate-200">
              {broker.publishers.length === 0 ? (
                <li className="text-slate-500">No active publishers</li>
              ) : (
                broker.publishers.map((id) => <li key={id}>{id}</li>)
              )}
            </ul>
          </div>
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">
              Active Subscribers ({broker.subscribers.length})
            </div>
            <ul className="space-y-1.5 text-xs">
              {broker.activeSubscriptions.length === 0 ? (
                <li className="text-slate-500">No active subscriptions</li>
              ) : (
                broker.activeSubscriptions.map((sub, i) => (
                  <li key={`${sub.clientId}-${sub.topic}-${i}`} className="font-mono">
                    <span className="text-slate-900 dark:text-slate-100">{sub.clientId}</span>
                    <div className="text-[11px] text-sky-600 dark:text-sky-400">
                      {sub.topic} (QoS {sub.qos})
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Active MQTT Topic Hierarchy
            </h2>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              hydro/building1/&lt;zone&gt;/&lt;deviceId&gt;/sensor|status|alert
            </span>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Topic</th>
                  <th className="py-2.5 px-3 font-medium text-right">Messages</th>
                  <th className="py-2.5 px-3 font-medium text-right">Last QoS</th>
                  <th className="py-2.5 px-3 font-medium text-right">Payload</th>
                  <th className="py-2.5 px-4 font-medium text-right">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {topics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Waiting for MQTT topic traffic...
                    </td>
                  </tr>
                ) : (
                  topics.map((t) => (
                    <tr key={t.topic} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-4 font-mono text-slate-900 dark:text-slate-100">
                        {t.topic}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {t.messageCount}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {t.lastQos}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">
                        {t.lastPayloadSize} B
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                        {formatTime(t.lastMessageAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Live Message Stream & Payload Inspector */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Live MQTT Message Log
            </h2>
            <input
              type="search"
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              placeholder="Filter by topic, clientId, or event..."
              className="px-3 py-1.5 text-xs rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 w-full sm:w-64"
            />
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-3 font-medium">Time</th>
                  <th className="py-2 px-3 font-medium">Event</th>
                  <th className="py-2 px-3 font-medium">Client ID</th>
                  <th className="py-2 px-3 font-medium">Topic</th>
                  <th className="py-2 px-3 font-medium text-right">QoS</th>
                  <th className="py-2 px-3 font-medium text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredEvents.slice(0, 60).map((ev) => {
                  const isSelected = selectedEvent?.id === ev.id;
                  return (
                    <tr
                      key={ev.id}
                      onClick={() => setSelectedEvent(ev)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-sky-50 dark:bg-sky-950/40'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-500">
                        {formatTime(ev.createdAt)}
                      </td>
                      <td className="py-2 px-3 font-mono font-medium text-slate-800 dark:text-slate-200">
                        {ev.eventType}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">
                        {ev.clientId}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                        {ev.topic}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {ev.qos}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">
                        {ev.payloadSize} B
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Payload Inspector
          </h2>
          {selectedEvent ? (
            <div className="space-y-3 text-xs">
              <div className="space-y-1 font-mono text-slate-600 dark:text-slate-300">
                <div>ID: {selectedEvent.messageId}</div>
                <div>Topic: {selectedEvent.topic}</div>
                <div>
                  QoS: {selectedEvent.qos} · Retain: {selectedEvent.retain ? 'true' : 'false'} ·{' '}
                  {selectedEvent.payloadSize} bytes
                </div>
                {selectedEvent.brokerAckMs !== null && (
                  <div>Broker ACK: {selectedEvent.brokerAckMs.toFixed(2)} ms</div>
                )}
                {selectedEvent.backendReceiptMs !== null && (
                  <div>Backend Receipt: {selectedEvent.backendReceiptMs.toFixed(2)} ms</div>
                )}
              </div>
              <pre className="p-3 rounded-md bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all border border-slate-800">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(selectedEvent.payloadPreview), null, 2);
                  } catch {
                    return selectedEvent.payloadPreview;
                  }
                })()}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Select a message row to inspect its payload.</p>
          )}
        </div>
      </section>
    </div>
  );
}
