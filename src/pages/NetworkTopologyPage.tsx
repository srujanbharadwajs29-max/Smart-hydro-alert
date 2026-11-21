import { useState } from 'react';
import { ConnectionStatusLabel, WaterStateLabel, formatTime } from '../components/StatusText';
import type { SystemStatusSnapshot, TopologyPulse, VirtualDevice } from '../types/hydro';

interface NetworkTopologyPageProps {
  snapshot: SystemStatusSnapshot;
  pulses: TopologyPulse[];
}

type SelectedNode =
  | { kind: 'device'; device: VirtualDevice }
  | { kind: 'broker' }
  | { kind: 'backend' }
  | { kind: 'database' }
  | { kind: 'websocket' }
  | { kind: 'client' };

export function NetworkTopologyPage({ snapshot, pulses }: NetworkTopologyPageProps) {
  const { devices, broker, backend, database, websocket } = snapshot;
  const [selected, setSelected] = useState<SelectedNode>({ kind: 'broker' });

  const recentPulseIds = new Set(pulses.slice(0, 6).map((p) => p.source));
  const brokerOnline = broker.status === 'ONLINE';
  const backendSubConnected = backend.subscriberConnected && brokerOnline;

  // Dynamic SVG height so 5–20 devices layout cleanly without overlap
  const deviceSpacing = 62;
  const svgHeight = Math.max(460, devices.length * deviceSpacing + 80);
  const centerY = svgHeight / 2;

  const selectedDeviceFresh =
    selected.kind === 'device'
      ? devices.find((d) => d.id === selected.device.id) ?? selected.device
      : null;

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Live Network Architecture Topology
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Interactive visualization driven strictly by active TCP MQTT sessions, backend subscriber status, SQLite persistence, and WebSocket clients. Click any node to inspect real metrics.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Interactive SVG Architecture Canvas */}
        <div className="xl:col-span-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <span>Architecture Path: Virtual Devices → MQTT Broker → Backend → DB &amp; WebSocket → React Client</span>
            <div className="flex items-center gap-4 font-mono">
              <span className="text-emerald-600 dark:text-emerald-400">Active Link</span>
              <span className="text-amber-600 dark:text-amber-400">Silent / Degraded</span>
              <span className="text-red-600 dark:text-red-400">Offline / Broken</span>
            </div>
          </div>

          <svg
            viewBox={`0 0 920 ${svgHeight}`}
            className="w-full min-w-[760px] h-auto select-none"
            role="img"
            aria-label="Live Smart Hydro Alert Network Architecture Topology"
          >
            {/* Device -> Broker Links */}
            {devices.map((dev, idx) => {
              const y = 50 + idx * deviceSpacing;
              const isConnected = dev.connectionStatus === 'CONNECTED' && brokerOnline;
              const isSilent = dev.connectionStatus === 'SILENT' && brokerOnline;
              const hasPulse = recentPulseIds.has(dev.id) && isConnected;
              const stroke = isConnected
                ? hasPulse
                  ? '#0284c7'
                  : '#16a34a'
                : isSilent
                ? '#d97706'
                : '#dc2626';

              return (
                <g key={`link-${dev.id}`}>
                  <path
                    d={`M 210 ${y} C 280 ${y}, 280 ${centerY}, 345 ${centerY}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={hasPulse ? 2.5 : 1.5}
                    strokeOpacity={isConnected ? 0.85 : 0.45}
                    className={isConnected ? 'animate-packet-flow' : undefined}
                  />
                </g>
              );
            })}

            {/* Broker -> Backend Link */}
            <line
              x1={495}
              y1={centerY}
              x2={565}
              y2={centerY}
              stroke={backendSubConnected ? '#0284c7' : '#dc2626'}
              strokeWidth={2.2}
              className={backendSubConnected ? 'animate-packet-flow' : undefined}
            />

            {/* Backend -> Database Link */}
            <path
              d={`M 715 ${centerY - 12} C 745 ${centerY - 12}, 745 ${centerY - 95}, 775 ${centerY - 95}`}
              fill="none"
              stroke="#16a34a"
              strokeWidth={1.8}
              className={backendSubConnected ? 'animate-packet-flow' : undefined}
            />

            {/* Backend -> WebSocket -> React Client Link */}
            <path
              d={`M 715 ${centerY + 12} C 745 ${centerY + 12}, 745 ${centerY + 85}, 775 ${centerY + 85}`}
              fill="none"
              stroke={websocket.connectedDashboards > 0 ? '#0284c7' : '#64748b'}
              strokeWidth={1.8}
              className={websocket.connectedDashboards > 0 ? 'animate-packet-flow' : undefined}
            />

            {/* Virtual Device Nodes */}
            {devices.map((dev, idx) => {
              const y = 50 + idx * deviceSpacing;
              const isSelected = selected.kind === 'device' && selected.device.id === dev.id;
              const isOnline = dev.connectionStatus === 'CONNECTED' && brokerOnline;
              const isSilent = dev.connectionStatus === 'SILENT' && brokerOnline;
              const borderStroke = isSelected
                ? '#0284c7'
                : isOnline
                ? '#16a34a'
                : isSilent
                ? '#d97706'
                : '#dc2626';

              return (
                <g
                  key={dev.id}
                  onClick={() => setSelected({ kind: 'device', device: dev })}
                  className="cursor-pointer"
                >
                  <rect
                    x={16}
                    y={y - 22}
                    width={194}
                    height={44}
                    rx={8}
                    className="fill-slate-50 dark:fill-slate-950"
                    stroke={borderStroke}
                    strokeWidth={isSelected ? 2.2 : 1.3}
                  />
                  <text
                    x={28}
                    y={y - 4}
                    className="fill-slate-900 dark:fill-slate-100 text-[12px] font-semibold"
                  >
                    {dev.name.slice(0, 22)}
                  </text>
                  <text
                    x={28}
                    y={y + 13}
                    className="fill-slate-500 dark:fill-slate-400 text-[10px]"
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {dev.connectionStatus} · {dev.flowRate.toFixed(1)} L/m · {dev.sensorState}
                  </text>
                </g>
              );
            })}

            {/* MQTT Broker Node */}
            <g onClick={() => setSelected({ kind: 'broker' })} className="cursor-pointer">
              <rect
                x={345}
                y={centerY - 46}
                width={150}
                height={92}
                rx={10}
                className="fill-slate-50 dark:fill-slate-950"
                stroke={
                  selected.kind === 'broker'
                    ? '#0284c7'
                    : brokerOnline
                    ? '#16a34a'
                    : '#dc2626'
                }
                strokeWidth={selected.kind === 'broker' ? 2.4 : 1.6}
              />
              <text
                x={420}
                y={centerY - 18}
                textAnchor="middle"
                className="fill-slate-900 dark:fill-slate-100 text-[13px] font-semibold"
              >
                MQTT Broker
              </text>
              <text
                x={420}
                y={centerY + 1}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px]"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                TCP :{broker.port}
              </text>
              <text
                x={420}
                y={centerY + 20}
                textAnchor="middle"
                className={
                  brokerOnline
                    ? 'fill-emerald-600 dark:fill-emerald-400 text-[11px] font-semibold'
                    : 'fill-red-600 dark:fill-red-400 text-[11px] font-semibold'
                }
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {broker.status} ({broker.connectedClients.length})
              </text>
            </g>

            {/* Backend Engine Node */}
            <g onClick={() => setSelected({ kind: 'backend' })} className="cursor-pointer">
              <rect
                x={565}
                y={centerY - 46}
                width={150}
                height={92}
                rx={10}
                className="fill-slate-50 dark:fill-slate-950"
                stroke={
                  selected.kind === 'backend'
                    ? '#0284c7'
                    : backendSubConnected
                    ? '#0284c7'
                    : '#d97706'
                }
                strokeWidth={selected.kind === 'backend' ? 2.4 : 1.6}
              />
              <text
                x={640}
                y={centerY - 18}
                textAnchor="middle"
                className="fill-slate-900 dark:fill-slate-100 text-[13px] font-semibold"
              >
                Backend Engine
              </text>
              <text
                x={640}
                y={centerY + 1}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px]"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                Express + MQTT Sub
              </text>
              <text
                x={640}
                y={centerY + 20}
                textAnchor="middle"
                className={
                  backendSubConnected
                    ? 'fill-emerald-600 dark:fill-emerald-400 text-[11px] font-semibold'
                    : 'fill-amber-600 dark:fill-amber-400 text-[11px] font-semibold'
                }
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {backend.status}
              </text>
            </g>

            {/* SQLite Database Node */}
            <g onClick={() => setSelected({ kind: 'database' })} className="cursor-pointer">
              <rect
                x={775}
                y={centerY - 135}
                width={130}
                height={80}
                rx={10}
                className="fill-slate-50 dark:fill-slate-950"
                stroke={selected.kind === 'database' ? '#0284c7' : '#16a34a'}
                strokeWidth={selected.kind === 'database' ? 2.4 : 1.5}
              />
              <text
                x={840}
                y={centerY - 108}
                textAnchor="middle"
                className="fill-slate-900 dark:fill-slate-100 text-[12px] font-semibold"
              >
                SQLite Database
              </text>
              <text
                x={840}
                y={centerY - 90}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px]"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {database.counts.readings} readings
              </text>
              <text
                x={840}
                y={centerY - 73}
                textAnchor="middle"
                className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-semibold"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {database.status}
              </text>
            </g>

            {/* WebSocket + React Client Node */}
            <g onClick={() => setSelected({ kind: 'websocket' })} className="cursor-pointer">
              <rect
                x={775}
                y={centerY + 45}
                width={130}
                height={80}
                rx={10}
                className="fill-slate-50 dark:fill-slate-950"
                stroke={selected.kind === 'websocket' ? '#0284c7' : '#0284c7'}
                strokeWidth={selected.kind === 'websocket' ? 2.4 : 1.5}
              />
              <text
                x={840}
                y={centerY + 72}
                textAnchor="middle"
                className="fill-slate-900 dark:fill-slate-100 text-[12px] font-semibold"
              >
                WebSocket / UI
              </text>
              <text
                x={840}
                y={centerY + 90}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px]"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                /ws ({websocket.connectedDashboards} client)
              </text>
              <text
                x={840}
                y={centerY + 107}
                textAnchor="middle"
                className="fill-sky-600 dark:fill-sky-400 text-[10px] font-semibold"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                LIVE STREAM
              </text>
            </g>
          </svg>
        </div>

        {/* Node Inspector Panel */}
        <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Node Inspector
          </h2>

          {selected.kind === 'device' && selectedDeviceFresh && (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Node</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">
                  {selectedDeviceFresh.name}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">MQTT Client ID</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200">
                  {selectedDeviceFresh.clientId}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Connection</dt>
                <dd>
                  <ConnectionStatusLabel status={selectedDeviceFresh.connectionStatus} />
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Water State</dt>
                <dd>
                  <WaterStateLabel state={selectedDeviceFresh.sensorState} />
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Sensor Topic</dt>
                <dd className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  {selectedDeviceFresh.sensorTopic}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Messages Published</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {selectedDeviceFresh.messagesPublished}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Last Broker ACK</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {selectedDeviceFresh.lastBrokerAckMs !== null
                    ? `${selectedDeviceFresh.lastBrokerAckMs.toFixed(2)} ms`
                    : '—'}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Last Seen</dt>
                <dd className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {formatTime(selectedDeviceFresh.lastCommunicationAt)}
                </dd>
              </div>
            </dl>
          )}

          {selected.kind === 'broker' && (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Broker Mode</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {broker.mode === 'embedded' ? 'Embedded Aedes' : 'External Mosquitto'}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Endpoint</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-100">
                  {broker.host}:{broker.port}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {broker.status}
                </dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Connected Sessions</dt>
                <dd className="font-mono tabular-nums">{broker.connectedClients.length}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Availability</dt>
                <dd className="font-mono tabular-nums">{broker.availabilityPct}%</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Uptime</dt>
                <dd className="font-mono tabular-nums">{broker.uptimeSeconds}s</dd>
              </div>
            </dl>
          )}

          {selected.kind === 'backend' && (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Subscriber ID</dt>
                <dd className="font-mono">{backend.subscriberClientId}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">MQTT Subscription</dt>
                <dd className="font-mono">hydro/+/+/+/+ (QoS 2)</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-mono font-semibold">{backend.status}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">API Key Guard</dt>
                <dd className="font-mono">{backend.apiKeyProtected ? 'Active' : 'Local Demo'}</dd>
              </div>
            </dl>
          )}

          {selected.kind === 'database' && (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Engine</dt>
                <dd className="font-mono">{database.engine}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">File Path</dt>
                <dd className="font-mono">{database.path}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Stored Readings</dt>
                <dd className="font-mono tabular-nums">{database.counts.readings}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Stored Alerts</dt>
                <dd className="font-mono tabular-nums">{database.counts.alerts}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">MQTT Events</dt>
                <dd className="font-mono tabular-nums">{database.counts.mqttEvents}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">QoS Runs</dt>
                <dd className="font-mono tabular-nums">{database.counts.qosExperiments}</dd>
              </div>
            </dl>
          )}

          {selected.kind === 'websocket' && (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Endpoint</dt>
                <dd className="font-mono">{websocket.endpoint}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Connected Dashboards</dt>
                <dd className="font-mono tabular-nums">{websocket.connectedDashboards}</dd>
              </div>
              <div className="py-2 flex justify-between">
                <dt className="text-slate-500">Delivery Mode</dt>
                <dd className="font-mono">Push Delta Events (No Polling)</dd>
              </div>
            </dl>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              Recent Live Transmissions
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-[11px]">
              {pulses.length === 0 ? (
                <div className="text-slate-500">Waiting for live MQTT messages...</div>
              ) : (
                pulses.slice(0, 8).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300"
                  >
                    <span className="truncate">{p.topic}</span>
                    <span className="text-slate-400 shrink-0">Q{p.qos}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
