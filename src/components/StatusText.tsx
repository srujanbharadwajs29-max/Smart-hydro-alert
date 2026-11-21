import type { DeviceConnectionStatus, WaterState } from '../types/hydro';

export function WaterStateLabel({ state }: { state: WaterState }) {
  const styles: Record<WaterState, string> = {
    NORMAL: 'text-emerald-700 dark:text-emerald-400',
    NORMAL_FLOW: 'text-sky-700 dark:text-sky-400',
    WARNING: 'text-amber-700 dark:text-amber-400',
    ALERT: 'text-orange-700 dark:text-orange-400',
    LEAK: 'text-rose-700 dark:text-rose-400',
    CRITICAL: 'text-red-700 dark:text-red-400 font-semibold',
  };

  return (
    <span className={`font-mono text-xs font-medium tracking-tight ${styles[state]}`}>
      {state}
    </span>
  );
}

export function ConnectionStatusLabel({ status }: { status: DeviceConnectionStatus }) {
  const config: Record<DeviceConnectionStatus, { text: string; cls: string }> = {
    CONNECTED: { text: 'Connected', cls: 'text-emerald-700 dark:text-emerald-400' },
    SILENT: { text: 'Silent (No Data)', cls: 'text-amber-700 dark:text-amber-400' },
    RECONNECTING: { text: 'Reconnecting', cls: 'text-amber-700 dark:text-amber-400' },
    DISCONNECTED: { text: 'Disconnected', cls: 'text-red-700 dark:text-red-400' },
    STOPPED: { text: 'Stopped', cls: 'text-slate-500 dark:text-slate-400' },
  };
  const item = config[status];
  return <span className={`text-xs font-medium ${item.cls}`}>{item.text}</span>;
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour12: false })}`;
}
