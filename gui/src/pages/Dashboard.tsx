import { useEffect, useState } from 'react';
import {
  Play, Square, AlertTriangle, Info, ArrowRight,
  FolderOpen, Copy, Archive, LayoutDashboard,
  AlertCircle, FileText, Plus, Trash2,
} from 'lucide-react';
import { api } from '../api.ts';
import { Card, Btn, Badge, StatCard } from '../components/ui.tsx';
import type { ActivityEvent } from '../types/activity.ts';

interface Props {
  events: ActivityEvent[];
}

function ConfirmStartModal({ watchedPaths, onConfirm, onCancel }: {
  watchedPaths: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-amber-600/40 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-gray-800">
          <div className="p-2 bg-amber-500/10 rounded-lg">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Start Auto-Organizer?</h2>
            <p className="text-xs text-gray-500 mt-0.5">Files will move automatically</p>
          </div>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-300">
            The daemon will watch these directories and <strong className="text-white">automatically move new files</strong> into category sub-folders:
          </p>
          <div className="space-y-1.5">
            {watchedPaths.map(p => (
              <div key={p} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                <FolderOpen size={14} className="text-amber-400 flex-shrink-0" />
                <span className="text-xs font-mono text-amber-200 truncate">{p}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            All moves are logged and reversible from the History page. Files below the confidence threshold go to <span className="font-mono text-gray-400">Uncategorized/</span>.
          </p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <Btn variant="secondary" onClick={onCancel} className="flex-1">Cancel</Btn>
          <Btn variant="success" onClick={onConfirm} className="flex-1">
            <Play size={14} /> Start Daemon
          </Btn>
        </div>
      </div>
    </div>
  );
}

function basename(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function dirname(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

/**
 * Last 1-2 path segments of a directory, for compact display.
 * `/Users/me/Docs/sandbox/software_engineer/Design Docs` → `software_engineer/Design Docs`
 */
function shortDir(dir: string): string {
  if (!dir) return '';
  const parts = dir.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

const KIND_STYLE: Record<string, { badge: string; label: string; icon: typeof ArrowRight; verb: string }> = {
  move: { badge: 'green', label: 'MOVE', icon: ArrowRight, verb: 'moved to' },
  quarantine: { badge: 'yellow', label: 'QUARANTINE', icon: Archive, verb: 'quarantined to' },
  dedup: { badge: 'purple', label: 'DEDUP', icon: Copy, verb: 'duplicate of' },
  skip: { badge: 'gray', label: 'SKIP', icon: Info, verb: 'skipped' },
  error: { badge: 'red', label: 'ERROR', icon: AlertCircle, verb: 'failed' },
  change: { badge: 'blue', label: 'NEW', icon: Plus, verb: '' },
  event: { badge: 'blue', label: 'EVENT', icon: Info, verb: '' },
};

const CHANGE_LABELS: Record<string, { label: string; icon: typeof Plus; badge: string }> = {
  add: { label: 'NEW', icon: Plus, badge: 'blue' },
  unlink: { label: 'REMOVED', icon: Trash2, badge: 'gray' },
  addDir: { label: 'NEW DIR', icon: FolderOpen, badge: 'blue' },
  unlinkDir: { label: 'DIR REMOVED', icon: FolderOpen, badge: 'gray' },
};

function ActivityItem({ entry }: { entry: ActivityEvent }) {
  const baseStyle = KIND_STYLE[entry.kind] ?? KIND_STYLE.event;
  // For dir-change events, refine the badge by changeType (add/unlink/etc).
  const style = entry.kind === 'change' && entry.changeType && CHANGE_LABELS[entry.changeType]
    ? { ...baseStyle, badge: CHANGE_LABELS[entry.changeType].badge, label: CHANGE_LABELS[entry.changeType].label, icon: CHANGE_LABELS[entry.changeType].icon }
    : baseStyle;

  const Icon = style.icon;
  const srcName = basename(entry.srcPath);
  const destDir = entry.destPath ? dirname(entry.destPath) : '';
  const destShort = shortDir(destDir);
  const confPct = typeof entry.confidence === 'number'
    ? `${Math.round(entry.confidence * 100)}%`
    : null;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors group"
      title={entry.srcPath + (entry.destPath ? `\n→ ${entry.destPath}` : '')}
    >
      <div className="flex-shrink-0 pt-0.5">
        <Badge color={style.badge}>{style.label}</Badge>
      </div>

      <div className="flex-1 min-w-0">
        {/* Top row: filename + arrow + destination */}
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={12} className="text-gray-600 flex-shrink-0" />
          <span className="text-sm text-gray-100 font-medium truncate">{srcName || '(unknown)'}</span>
          {destShort && (
            <>
              <ArrowRight size={12} className="text-gray-600 flex-shrink-0" />
              <span className="text-xs text-emerald-300/90 font-mono truncate">{destShort}</span>
            </>
          )}
        </div>

        {/* Bottom row: category + confidence + error */}
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
          {entry.category && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 font-medium">
              <Icon size={10} />
              {entry.category}
            </span>
          )}
          {confPct && (
            <span className="text-gray-500">{confPct} confidence</span>
          )}
          {entry.error && (
            <span className="text-red-400 font-mono truncate">{entry.error}</span>
          )}
          {!entry.category && !entry.error && entry.kind === 'change' && (
            <span className="text-gray-600 font-mono truncate">{entry.srcPath}</span>
          )}
        </div>
      </div>

      <span className="text-xs text-gray-700 group-hover:text-gray-500 whitespace-nowrap flex-shrink-0">
        {entry.ts.toLocaleTimeString()}
      </span>
    </div>
  );
}

type Filter = 'all' | 'move' | 'quarantine' | 'error';

export default function Dashboard({ events }: Props) {
  const [status, setStatus] = useState({ running: false, watchedPaths: [] as string[] });
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = () => api.daemonStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const startDaemon = async () => {
    setLoading(true);
    try { await api.daemonStart(); await refresh(); }
    finally { setLoading(false); setShowConfirm(false); }
  };

  const stopDaemon = async () => {
    setLoading(true);
    try { await api.daemonStop(); await refresh(); }
    finally { setLoading(false); }
  };

  // Hide events older than the last clear timestamp.
  const visible = cleared
    ? events.filter(e => e.id > cleared)
    : events;
  const filtered = filter === 'all'
    ? visible
    : visible.filter(e => e.kind === filter);

  const organized = visible.filter(e => e.kind === 'move').length;
  const quarantined = visible.filter(e => e.kind === 'quarantine').length;
  const errored = visible.filter(e => e.kind === 'error').length;

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-800">
        <div className="flex items-center gap-3 mb-1">
          <LayoutDashboard size={20} className="text-blue-400" />
          <h1 className="text-xl font-semibold text-white">Dashboard</h1>
        </div>
        <p className="text-sm text-gray-500">Overview of FileFlow activity</p>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Moved" value={organized} sub="files organized" accent="text-emerald-400" />
          <StatCard label="Quarantined" value={quarantined} sub="needs review" accent={quarantined > 0 ? 'text-amber-400' : 'text-gray-400'} />
          <StatCard label="Errors" value={errored} sub={errored === 1 ? 'failure' : 'failures'} accent={errored > 0 ? 'text-red-400' : 'text-gray-400'} />
          <StatCard label="Daemon" value={status.running ? 'Running' : 'Stopped'} sub={status.running ? `${status.watchedPaths.length} dir watched` : 'manual mode'} accent={status.running ? 'text-emerald-400' : 'text-gray-400'} />
        </div>

        {/* Daemon control */}
        <Card className={`transition-colors duration-300 ${status.running ? 'border-emerald-600/40' : 'border-gray-800'}`}>
          <div className="p-5 flex items-center gap-4">
            {/* Status dot */}
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              status.running ? 'bg-emerald-500/10' : 'bg-gray-800'
            }`}>
              <span className={`w-3 h-3 rounded-full ${
                status.running ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-gray-600'
              } ${status.running ? 'animate-pulse' : ''}`} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white">
                {status.running ? 'Daemon Active' : 'Daemon Stopped'}
              </p>
              {status.running && status.watchedPaths.length > 0 ? (
                <p className="text-xs text-emerald-400 font-mono mt-0.5 truncate">
                  Watching: {status.watchedPaths[0]}
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-0.5">
                  Use <span className="font-mono text-gray-400">Files → Organize Now</span> for manual control
                </p>
              )}
            </div>

            {status.running ? (
              <Btn variant="danger" onClick={stopDaemon} disabled={loading}>
                <Square size={14} /> Stop
              </Btn>
            ) : (
              <Btn variant="success" onClick={() => setShowConfirm(true)} disabled={loading}>
                <Play size={14} /> Start
              </Btn>
            )}
          </div>

          {!status.running && (
            <div className="flex items-start gap-2 px-5 pb-4 text-xs text-gray-600">
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              <span>The daemon is <strong className="text-gray-500">off by default</strong>. When started it moves new files automatically. Organize Now is safer for first-time use.</span>
            </div>
          )}
        </Card>

        {/* Activity feed */}
        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">Activity</span>
              {visible.length > 0 && (
                <Badge color="gray">{visible.length}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'move', 'quarantine', 'error'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    filter === f
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              {visible.length > 0 && (
                <button
                  onClick={() => setCleared(events[0]?.id ?? null)}
                  className="ml-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="divide-y divide-gray-800/60 max-h-96 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center">
                <ArrowRight size={28} className="text-gray-800 mb-3" />
                <p className="text-gray-500 text-sm">
                  {visible.length === 0 ? 'No activity yet' : `No ${filter} events`}
                </p>
                <p className="text-gray-700 text-xs mt-1">
                  {visible.length === 0
                    ? 'Move files or start the daemon to see events'
                    : 'Try a different filter'}
                </p>
              </div>
            ) : (
              filtered.map(e => <ActivityItem key={e.id} entry={e} />)
            )}
          </div>
        </Card>

        {/* Watched paths */}
        {status.watchedPaths.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-sm font-medium text-white">Watched Directories</p>
            </div>
            <div className="divide-y divide-gray-800/60">
              {status.watchedPaths.map(p => (
                <div key={p} className="flex items-center gap-3 px-4 py-3">
                  <div className="p-1.5 bg-blue-500/10 rounded-md">
                    <FolderOpen size={14} className="text-blue-400" />
                  </div>
                  <span className="text-sm font-mono text-gray-300 truncate">{p}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {showConfirm && (
        <ConfirmStartModal
          watchedPaths={status.watchedPaths}
          onConfirm={startDaemon}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
