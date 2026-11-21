import { useEffect, useState, type FormEvent } from 'react';
import { hydroApi } from '../lib/api';
import type { SystemStatusSnapshot, WaterThresholds } from '../types/hydro';

interface SystemSettingsPageProps {
  snapshot: SystemStatusSnapshot;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onRefresh: () => void;
}

export function SystemSettingsPage({
  snapshot,
  theme,
  onToggleTheme,
  onRefresh,
}: SystemSettingsPageProps) {
  const [form, setForm] = useState<WaterThresholds>(snapshot.thresholds);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(snapshot.thresholds);
  }, [snapshot.thresholds]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await hydroApi.updateSettings(form);
      setMessage('System thresholds saved and applied to live Water Intelligence Engine.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearHistory = async () => {
    setClearing(true);
    setMessage(null);
    try {
      await hydroApi.clearHistory();
      onRefresh();
      setMessage('Cleared persisted sensor readings, alerts, MQTT logs, and network event history.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          System Settings &amp; Wireshark Capture Guide
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Configure Water Intelligence thresholds, heartbeat timeout, virtual device limits, display theme, and loopback packet inspection filters.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Threshold Configuration Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-2 p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Water Intelligence &amp; Network Monitoring Thresholds
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="th-flow" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Active Flow Gate (L/min)
              </label>
              <input
                id="th-flow"
                type="number"
                step={0.1}
                min={0.1}
                max={20}
                value={form.flowActiveThresholdLpm}
                onChange={(e) =>
                  setForm({ ...form, flowActiveThresholdLpm: Number(e.target.value) })
                }
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label htmlFor="th-crit" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Critical Flow Threshold (L/min)
              </label>
              <input
                id="th-crit"
                type="number"
                step={0.5}
                min={5}
                max={100}
                value={form.criticalFlowThresholdLpm}
                onChange={(e) =>
                  setForm({ ...form, criticalFlowThresholdLpm: Number(e.target.value) })
                }
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label htmlFor="th-warn" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Unattended WARNING Window (seconds)
              </label>
              <input
                id="th-warn"
                type="number"
                min={3}
                max={600}
                value={form.warningUnattendedSec}
                onChange={(e) => setForm({ ...form, warningUnattendedSec: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label htmlFor="th-alert" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Continuous Wastage ALERT Window (seconds)
              </label>
              <input
                id="th-alert"
                type="number"
                min={6}
                max={1200}
                value={form.alertWastageSec}
                onChange={(e) => setForm({ ...form, alertWastageSec: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label htmlFor="th-hb" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Silent Publisher Heartbeat Timeout (seconds)
              </label>
              <input
                id="th-hb"
                type="number"
                min={4}
                max={120}
                value={form.heartbeatTimeoutSec}
                onChange={(e) => setForm({ ...form, heartbeatTimeoutSec: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>

            <div>
              <label htmlFor="th-max" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Max Virtual Devices Limit (5–50)
              </label>
              <input
                id="th-max"
                type="number"
                min={5}
                max={50}
                value={form.maxDevices}
                onChange={(e) => setForm({ ...form, maxDevices: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button
              type="button"
              disabled={clearing}
              onClick={handleClearHistory}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : 'Prune Telemetry History'}
            </button>
          </div>

          {message && <p className="text-xs text-sky-700 dark:text-sky-300">{message}</p>}
        </form>

        {/* Appearance & Runtime Details */}
        <div className="space-y-6">
          <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Interface Appearance
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Switch between dark operations console and high-contrast light presentation mode.
            </p>
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-full px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Current Theme: {theme === 'dark' ? 'Dark Mode (Switch to Light)' : 'Light Mode (Switch to Dark)'}
            </button>
          </div>

          <div className="p-5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Wireshark Loopback Quick Filters
            </h2>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
              This app does not capture packets inside the browser. Use Wireshark on Windows with Npcap (&ldquo;Adapter for loopback traffic capture&rdquo;) against TCP port{' '}
              <span className="font-mono text-slate-800 dark:text-slate-200">{snapshot.broker.port}</span>.
            </p>
            <div className="space-y-1.5 font-mono text-[11px] bg-slate-950 text-slate-200 p-3 rounded-md border border-slate-800">
              <div># All MQTT traffic on broker port</div>
              <div className="text-sky-400">tcp.port == {snapshot.broker.port} &amp;&amp; mqtt</div>
              <div className="pt-1"># CONNECT &amp; CONNACK handshake</div>
              <div className="text-sky-400">mqtt.msgtype == 1 || mqtt.msgtype == 2</div>
              <div className="pt-1"># QoS 1 PUBACK &amp; QoS 2 4-way flow</div>
              <div className="text-sky-400">mqtt.msgtype in &#123;3, 4, 5, 6, 7&#125;</div>
            </div>
            <p className="text-slate-500 dark:text-slate-400">
              Full step-by-step guide available in <span className="font-mono">docs/WIRESHARK_GUIDE.md</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
