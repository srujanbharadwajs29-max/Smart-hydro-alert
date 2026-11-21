import { useState } from 'react';
import { Download } from 'lucide-react';
import { WaterStateLabel, formatDateTime } from '../components/StatusText';
import { hydroApi } from '../lib/api';
import type { SystemStatusSnapshot, WaterAlertRecord } from '../types/hydro';

type SeverityFilter = 'ALL' | WaterAlertRecord['severity'];

export function AlertHistoryPage({ snapshot }: { snapshot: SystemStatusSnapshot }) {
  const { recentAlerts } = snapshot;
  const [severity, setSeverity] = useState<SeverityFilter>('ALL');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const filtered = recentAlerts.filter((a) => {
    if (severity !== 'ALL' && a.severity !== severity) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        a.deviceName.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleAck = async (id: number) => {
    setBusyId(id);
    try {
      await hydroApi.acknowledgeAlert(id);
    } finally {
      setBusyId(null);
    }
  };

  const handleExportCsv = () => {
    const header = ['ID', 'Timestamp', 'Device', 'Location', 'Severity', 'Flow_Lpm', 'Wastage_L', 'Acknowledged', 'Message'];
    const rows = filtered.map((a) => [
      a.id,
      a.createdAt,
      `"${a.deviceName.replace(/"/g, '""')}"`,
      `"${a.location.replace(/"/g, '""')}"`,
      a.severity,
      a.flowRate.toFixed(2),
      a.estimatedWastageLiters.toFixed(3),
      a.acknowledged ? 'YES' : 'NO',
      `"${a.message.replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hydro-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Water Alert History
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Persisted SQLite ledger of WARNING, ALERT, LEAK, and CRITICAL transitions detected by the Water Intelligence Engine.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Download CSV
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
          {(['ALL', 'WARNING', 'ALERT', 'LEAK', 'CRITICAL'] as SeverityFilter[]).map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverity(sev)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                severity === sev
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search device, location, or alert reason..."
          className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 sm:w-72"
        />
      </div>

      {/* Alert Table */}
      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-3 font-medium">Device</th>
                <th className="py-3 px-3 font-medium">Severity</th>
                <th className="py-3 px-3 font-medium text-right">Flow (L/min)</th>
                <th className="py-3 px-3 font-medium">Reason</th>
                <th className="py-3 px-4 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    No matching water alerts found. Trigger WARNING, ALERT, LEAK, or CRITICAL scenarios in Water Monitoring to populate this ledger.
                  </td>
                </tr>
              ) : (
                filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatDateTime(a.createdAt)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{a.deviceName}</div>
                      <div className="text-[11px] text-slate-500">{a.location}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <WaterStateLabel state={a.severity} />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {a.flowRate.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-md">
                      {a.message}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      {a.acknowledged ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Acknowledged
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === a.id}
                          onClick={() => handleAck(a.id)}
                          className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Acknowledge
                        </button>
                      )}
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
