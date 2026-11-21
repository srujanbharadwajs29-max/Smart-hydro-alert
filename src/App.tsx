import { useEffect, useState, type ComponentType } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cpu,
  Droplets,
  Gauge,
  LayoutDashboard,
  Menu,
  Moon,
  Network,
  Radio,
  Settings,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { useHydroNetwork } from './hooks/useHydroNetwork';
import { AlertHistoryPage } from './pages/AlertHistoryPage';
import { FailureSimulatorPage } from './pages/FailureSimulatorPage';
import { MqttCenterPage } from './pages/MqttCenterPage';
import { NetworkAnalyticsPage } from './pages/NetworkAnalyticsPage';
import { NetworkTopologyPage } from './pages/NetworkTopologyPage';
import { OverviewPage } from './pages/OverviewPage';
import { QosLabPage } from './pages/QosLabPage';
import { SystemSettingsPage } from './pages/SystemSettingsPage';
import { VirtualDeviceLabPage } from './pages/VirtualDeviceLabPage';
import { WaterMonitoringPage } from './pages/WaterMonitoringPage';

type PageId =
  | 'overview'
  | 'water'
  | 'devices'
  | 'mqtt'
  | 'qos'
  | 'analytics'
  | 'topology'
  | 'failures'
  | 'alerts'
  | 'settings';

const NAV_ITEMS: Array<{
  id: PageId;
  label: string;
  section: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview Dashboard', section: 'Monitoring', icon: LayoutDashboard },
  { id: 'water', label: 'Water Monitoring', section: 'Monitoring', icon: Droplets },
  { id: 'devices', label: 'Virtual Device Lab', section: 'Simulation', icon: Cpu },
  { id: 'mqtt', label: 'MQTT Center', section: 'Networking', icon: Radio },
  { id: 'qos', label: 'MQTT QoS Lab', section: 'Networking', icon: Gauge },
  { id: 'analytics', label: 'Network Analytics', section: 'Networking', icon: BarChart3 },
  { id: 'topology', label: 'Network Topology', section: 'Networking', icon: Network },
  { id: 'failures', label: 'Failure Simulator', section: 'Simulation', icon: WifiOff },
  { id: 'alerts', label: 'Alert History', section: 'Monitoring', icon: AlertTriangle },
  { id: 'settings', label: 'System Settings', section: 'System', icon: Settings },
];

export default function App() {
  const { snapshot, wsState, error, pulses, refresh } = useHydroNetwork();
  const [activePage, setActivePage] = useState<PageId>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const currentNav = NAV_ITEMS.find((n) => n.id === activePage) ?? NAV_ITEMS[0];
  const unackCount = snapshot?.recentAlerts.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="h-14 px-5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Activity className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="font-semibold text-sm tracking-tight text-slate-900 dark:text-slate-100 truncate">
              Smart Hydro Network
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'alerts' && unackCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-red-600 dark:text-red-400 font-semibold">
                    {unackCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
          <div className="font-medium text-slate-700 dark:text-slate-300">
            Virtual Smart Hydro Alert Network
          </div>
          <div className="font-mono">
            MQTT TCP :{snapshot?.broker.port ?? 1883} · WS {wsState}
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-semibold text-sm">Smart Hydro Network</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActivePage(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium ${
                      active
                        ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Context Header (Strict breadcrumb left, minimal controls right) */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="hidden sm:inline">{currentNav.section}</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentNav.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span>
                Broker:{' '}
                <strong
                  className={
                    snapshot?.broker.status === 'ONLINE'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                >
                  {snapshot?.broker.status ?? 'LOADING'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                WS:{' '}
                <strong
                  className={
                    wsState === 'CONNECTED'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }
                >
                  {wsState}
                </strong>
              </span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle light or dark theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] w-full mx-auto">
          {error && !snapshot ? (
            <div className="p-6 rounded-lg bg-white dark:bg-slate-900 border border-red-300 dark:border-red-900 space-y-3">
              <h2 className="text-base font-semibold text-red-700 dark:text-red-400">
                Unable to Reach Backend Server
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-sky-600 text-white hover:bg-sky-700"
              >
                Retry Connection
              </button>
            </div>
          ) : !snapshot ? (
            <div className="space-y-4">
              <div className="h-10 w-72 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-28 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              {activePage === 'overview' && (
                <OverviewPage
                  snapshot={snapshot}
                  onNavigate={(p) => setActivePage(p as PageId)}
                />
              )}
              {activePage === 'water' && <WaterMonitoringPage snapshot={snapshot} />}
              {activePage === 'devices' && <VirtualDeviceLabPage snapshot={snapshot} />}
              {activePage === 'mqtt' && <MqttCenterPage snapshot={snapshot} />}
              {activePage === 'qos' && <QosLabPage snapshot={snapshot} />}
              {activePage === 'analytics' && <NetworkAnalyticsPage snapshot={snapshot} />}
              {activePage === 'topology' && (
                <NetworkTopologyPage snapshot={snapshot} pulses={pulses} />
              )}
              {activePage === 'failures' && <FailureSimulatorPage snapshot={snapshot} />}
              {activePage === 'alerts' && <AlertHistoryPage snapshot={snapshot} />}
              {activePage === 'settings' && (
                <SystemSettingsPage
                  snapshot={snapshot}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  onRefresh={refresh}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
