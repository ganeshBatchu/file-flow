import { useEffect, useMemo, useState } from 'react';
import {
  RotateCcw, RefreshCw, Clock, ArrowRight, Folder, File, CheckCircle2,
  AlertCircle, ChevronDown, ChevronRight, Search, X, Filter, Copy,
  ExternalLink, CheckSquare, Square,
} from 'lucide-react';
import { api, type JournalEntry } from '../api.ts';
import { Card, Btn, Badge, EmptyState, Spinner } from '../components/ui.tsx';

// ── Time helpers ──────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayHeader(d: Date): string {
  const now = new Date();
  if (isSameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Filters ───────────────────────────────────────────────────
type TimeFilter = 'all' | '10m' | '1h' | 'today' | 'week';

const TIME_FILTERS: { value: TimeFilter; label: string; maxAgeMs: number | null }[] = [
  { value: 'all', label: 'All', maxAgeMs: null },
  { value: '10m', label: 'Last 10 min', maxAgeMs: 10 * 60 * 1000 },
  { value: '1h', label: 'Last hour', maxAgeMs: 60 * 60 * 1000 },
  { value: 'today', label: 'Today', maxAgeMs: null }, // handled specially
  { value: 'week', label: 'Last week', maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
];

function passesTimeFilter(entry: JournalEntry, tf: TimeFilter): boolean {
  if (tf === 'all') return true;
  const ts = new Date(entry.timestamp);
  const now = new Date();
  if (tf === 'today') return isSameDay(ts, now);
  const spec = TIME_FILTERS.find((f) => f.value === tf);
  if (!spec || spec.maxAgeMs === null) return true;
  return now.getTime() - ts.getTime() <= spec.maxAgeMs;
}

function passesSearch(entry: JournalEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (entry.category?.toLowerCase().includes(needle)) return true;
  return entry.operations.some(
    (op) =>
      op.from?.toLowerCase().includes(needle) ||
      op.to?.toLowerCase().includes(needle) ||
      op.path?.toLowerCase().includes(needle),
  );
}

function passesCategory(entry: JournalEntry, cat: string | null): boolean {
  if (!cat) return true;
  return entry.category === cat;
}

// ── Operation row with per-op actions ─────────────────────────
function OperationRow({
  op, selected, onToggle, selectable,
}: {
  op: JournalEntry['operations'][0];
  selected: boolean;
  onToggle?: () => void;
  selectable: boolean;
}) {
  const renderActions = (targetPath: string) => (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={(e) => { e.stopPropagation(); api.revealInFolder(targetPath).catch(() => {}); }}
        title="Reveal in Finder"
        className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-white"
      >
        <ExternalLink size={11} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); api.copyPath(targetPath).catch(() => {}); }}
        title="Copy path"
        className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-white"
      >
        <Copy size={11} />
      </button>
    </div>
  );

  const wrapperClass = `group flex items-center gap-2 py-2 px-3 rounded-lg transition-colors border ${
    selected
      ? 'bg-amber-500/10 border-amber-500/30'
      : 'bg-gray-800/50 border-transparent hover:border-gray-700'
  }`;

  if (op.type === 'move' && op.from && op.to) {
    const fromName = op.from.split('/').pop() ?? op.from;
    const toPath = op.to.split('/').slice(-2).join('/');
    return (
      <div className={wrapperClass} onClick={selectable ? onToggle : undefined} style={selectable ? { cursor: 'pointer' } : undefined}>
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="accent-amber-500 w-3.5 h-3.5 flex-shrink-0"
          />
        )}
        <File size={12} className="text-gray-500 flex-shrink-0" />
        <span className="text-xs font-mono text-gray-300 truncate max-w-[180px]" title={op.from}>{fromName}</span>
        <ArrowRight size={11} className="text-gray-600 flex-shrink-0" />
        <Folder size={12} className="text-blue-400 flex-shrink-0" />
        <span className="text-xs font-mono text-blue-300 truncate flex-1" title={op.to}>{toPath}</span>
        {renderActions(op.to)}
      </div>
    );
  }
  if (op.type === 'mkdir' && op.path) {
    return (
      <div className={wrapperClass} onClick={selectable ? onToggle : undefined} style={selectable ? { cursor: 'pointer' } : undefined}>
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="accent-amber-500 w-3.5 h-3.5 flex-shrink-0"
          />
        )}
        <Folder size={12} className="text-emerald-400 flex-shrink-0" />
        <span className="text-xs font-mono text-gray-500">Created </span>
        <span className="text-xs font-mono text-gray-300 truncate flex-1">{op.path.split('/').pop()}</span>
        {renderActions(op.path)}
      </div>
    );
  }
  return (
    <div className={wrapperClass}>
      {selectable && <div className="w-3.5 h-3.5 flex-shrink-0" />}
      <span className="text-xs font-mono text-gray-500">{op.type}: {op.from ?? op.path ?? ''}</span>
    </div>
  );
}

// ── Undo confirmation modal ───────────────────────────────────
interface UndoTarget {
  entryId: string;
  /** null = full entry undo; otherwise the specific op indices. */
  operationIndices: number[] | null;
  /** Pre-computed for display. */
  entries: JournalEntry[];
}

function UndoConfirmModal({
  target, onConfirm, onCancel,
}: {
  target: UndoTarget;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Flatten all operations that would actually be reversed.
  const rows: { op: JournalEntry['operations'][0]; entryId: string }[] = [];
  for (const entry of target.entries) {
    const ids = target.operationIndices ?? entry.operations.map((_, i) => i);
    for (const i of ids) {
      const op = entry.operations[i];
      if (op) rows.push({ op, entryId: entry.id });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <RotateCcw size={16} className="text-amber-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Confirm Undo</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {rows.length} operation{rows.length !== 1 ? 's' : ''} will be reversed
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-1.5">
          {rows.length === 0 ? (
            <EmptyState icon={<AlertCircle size={28} />} title="Nothing to undo" />
          ) : (
            rows.map((r, i) => {
              if (r.op.type === 'move' && r.op.from && r.op.to) {
                const fromName = r.op.to.split('/').pop() ?? r.op.to;
                const backPath = r.op.from.split('/').slice(-2).join('/');
                return (
                  <div key={i} className="flex items-center gap-2 py-2 px-3 bg-gray-800/50 rounded-lg border border-gray-800">
                    <File size={12} className="text-gray-500 flex-shrink-0" />
                    <span className="text-xs font-mono text-gray-300 truncate max-w-[180px]" title={r.op.to}>{fromName}</span>
                    <ArrowRight size={11} className="text-amber-500 flex-shrink-0" />
                    <Folder size={12} className="text-emerald-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-emerald-300 truncate flex-1" title={r.op.from}>{backPath}</span>
                  </div>
                );
              }
              return (
                <div key={i} className="py-2 px-3 bg-gray-800/50 rounded-lg text-xs text-gray-500">
                  {r.op.type}: {r.op.path ?? r.op.to ?? r.op.from}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={onConfirm} disabled={rows.length === 0}>
            <RotateCcw size={13} /> Undo {rows.length}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Entry card ────────────────────────────────────────────────
interface EntryCardProps {
  entry: JournalEntry;
  selectMode: boolean;
  entrySelected: boolean;
  onEntryToggle: () => void;
  selectedOps: Set<number>;
  onOpToggle: (opIdx: number) => void;
  onEntryUndo: () => void;
  onPartialUndo: () => void;
  expanded: boolean;
  onExpandToggle: () => void;
}

function EntryCard({
  entry, selectMode, entrySelected, onEntryToggle,
  selectedOps, onOpToggle, onEntryUndo, onPartialUndo,
  expanded, onExpandToggle,
}: EntryCardProps) {
  const moves = entry.operations.filter((o) => o.type === 'move');

  return (
    <Card className={`transition-colors ${entrySelected ? 'border-amber-500/40' : ''}`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          {selectMode && (
            <button
              onClick={onEntryToggle}
              className="mt-1 flex-shrink-0"
              title={entrySelected ? 'Deselect entry' : 'Select entry'}
            >
              {entrySelected
                ? <CheckSquare size={16} className="text-amber-400" />
                : <Square size={16} className="text-gray-600 hover:text-gray-400" />}
            </button>
          )}
          <button
            onClick={onExpandToggle}
            className="p-1.5 rounded-lg flex-shrink-0 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown size={13} className="text-emerald-400" /> : <ChevronRight size={13} className="text-emerald-400" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {entry.category && <Badge color="blue">{entry.category}</Badge>}
              {entry.confidence != null && (
                <Badge color={entry.confidence >= 0.7 ? 'green' : 'yellow'}>
                  {(entry.confidence * 100).toFixed(0)}%
                </Badge>
              )}
              <Badge color="gray">{moves.length} file{moves.length !== 1 ? 's' : ''}</Badge>
              {selectedOps.size > 0 && (
                <Badge color="yellow">{selectedOps.size} selected</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-600" title={new Date(entry.timestamp).toLocaleString()}>
              {timeAgo(entry.timestamp)}
            </span>
            {selectedOps.size > 0 ? (
              <Btn variant="secondary" size="sm" onClick={onPartialUndo} title="Undo only the selected files">
                <RotateCcw size={12} /> Undo {selectedOps.size}
              </Btn>
            ) : (
              <Btn variant="ghost" size="sm" onClick={onEntryUndo} title="Undo the entire entry">
                <RotateCcw size={12} /> Undo
              </Btn>
            )}
          </div>
        </div>

        {/* Operations */}
        <div className="space-y-1.5 pl-8">
          {(expanded ? entry.operations : entry.operations.slice(0, 3)).map((op, i) => (
            <OperationRow
              key={i}
              op={op}
              selected={selectedOps.has(i)}
              onToggle={() => onOpToggle(i)}
              selectable={expanded && op.type === 'move'}
            />
          ))}
          {!expanded && entry.operations.length > 3 && (
            <button
              onClick={onExpandToggle}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors px-3 py-1"
            >
              +{entry.operations.length - 3} more operations
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Main History page ────────────────────────────────────────
export default function History() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Select mode + selections
  const [selectMode, setSelectMode] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  // Per-entry per-operation selections: entryId → Set<operation index>
  const [selectedOps, setSelectedOps] = useState<Map<string, Set<number>>>(new Map());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Pending undo (for confirm modal)
  const [pendingUndo, setPendingUndo] = useState<UndoTarget | null>(null);

  // Toast messages
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await api.getHistory());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Derived filtered list ────────────────────────────────
  const filteredEntries = useMemo(() => {
    return entries.filter((e) =>
      passesTimeFilter(e, timeFilter) &&
      passesSearch(e, search) &&
      passesCategory(e, categoryFilter),
    );
  }, [entries, timeFilter, search, categoryFilter]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.category) set.add(e.category);
    return [...set].sort();
  }, [entries]);

  // Group by day header
  const grouped = useMemo(() => {
    const groups: { label: string; entries: JournalEntry[] }[] = [];
    for (const e of filteredEntries) {
      const label = dayHeader(new Date(e.timestamp));
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.entries.push(e);
      } else {
        groups.push({ label, entries: [e] });
      }
    }
    return groups;
  }, [filteredEntries]);

  const totalSelectedOps = useMemo(() => {
    let n = 0;
    for (const s of selectedOps.values()) n += s.size;
    return n;
  }, [selectedOps]);

  // ── Handlers ─────────────────────────────────────────────
  const toggleEntrySelected = (id: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleOp = (entryId: string, opIdx: number) => {
    setSelectedOps((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(entryId) ?? []);
      if (set.has(opIdx)) set.delete(opIdx); else set.add(opIdx);
      if (set.size === 0) next.delete(entryId); else next.set(entryId, set);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runUndo = async (target: UndoTarget) => {
    try {
      // Issue reversal calls. For multi-entry undo we go newest-first so
      // nested paths unwind correctly.
      const sortedEntries = [...target.entries].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      );
      let reversed = 0;
      const errors: string[] = [];
      for (const entry of sortedEntries) {
        const res = target.operationIndices === null
          ? await api.undo(entry.id)
          : await api.undoOperations(entry.id, target.operationIndices);
        reversed += res.reversed.length;
        errors.push(...res.errors);
      }
      await load();
      // Clear selections that were just consumed
      setSelectedOps((prev) => {
        const next = new Map(prev);
        for (const e of target.entries) next.delete(e.id);
        return next;
      });
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        for (const e of target.entries) next.delete(e.id);
        return next;
      });
      if (errors.length > 0) {
        setToast({ kind: 'err', text: `${reversed} reversed · ${errors.length} error${errors.length !== 1 ? 's' : ''}` });
      } else {
        setToast({ kind: 'ok', text: `Reversed ${reversed} operation${reversed !== 1 ? 's' : ''}` });
      }
    } catch (err) {
      setToast({ kind: 'err', text: (err as Error).message });
    } finally {
      setPendingUndo(null);
    }
  };

  const requestEntryUndo = (entry: JournalEntry) => {
    setPendingUndo({ entryId: entry.id, operationIndices: null, entries: [entry] });
  };

  const requestPartialUndo = (entry: JournalEntry) => {
    const ops = selectedOps.get(entry.id);
    if (!ops || ops.size === 0) return;
    setPendingUndo({ entryId: entry.id, operationIndices: [...ops], entries: [entry] });
  };

  const requestBatchUndo = () => {
    const selected = entries.filter((e) => selectedEntryIds.has(e.id));
    if (selected.length === 0) return;
    setPendingUndo({
      entryId: 'batch',
      operationIndices: null,
      entries: selected,
    });
  };

  const clearAllFilters = () => {
    setSearch('');
    setTimeFilter('all');
    setCategoryFilter(null);
  };

  const hasActiveFilters = search !== '' || timeFilter !== 'all' || categoryFilter !== null;

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="px-8 pt-8 pb-5 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-amber-400" />
            <h1 className="text-xl font-semibold text-white">History</h1>
            {entries.length > 0 && <Badge color="gray">{filteredEntries.length} / {entries.length}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Btn
              variant={selectMode ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedEntryIds(new Set());
              }}
            >
              {selectMode ? <CheckSquare size={13} /> : <Square size={13} />}
              {selectMode ? 'Selecting' : 'Select'}
            </Btn>
            {selectMode && selectedEntryIds.size > 0 && (
              <Btn variant="danger" size="sm" onClick={requestBatchUndo}>
                <RotateCcw size={13} /> Undo {selectedEntryIds.size}
              </Btn>
            )}
            <Btn variant="ghost" size="sm" onClick={load} title="Reload history">
              <RefreshCw size={13} />
            </Btn>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename, path, or category…"
            className="w-full bg-gray-900 border border-gray-800 focus:border-blue-500 rounded-lg pl-9 pr-9 py-2 text-sm font-mono outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Filter size={11} /> Time:
          </span>
          {TIME_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTimeFilter(f.value)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                timeFilter === f.value
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}

          {allCategories.length > 0 && (
            <>
              <span className="text-xs text-gray-600 mx-1">·</span>
              <span className="text-xs text-gray-500">Category:</span>
              <button
                onClick={() => setCategoryFilter(null)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  categoryFilter === null
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'
                }`}
              >
                All
              </button>
              {allCategories.slice(0, 8).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    categoryFilter === cat
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                      : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </>
          )}

          {hasActiveFilters && (
            <>
              <span className="text-xs text-gray-600 mx-1">·</span>
              <button
                onClick={clearAllFilters}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-white transition-colors"
                title="Clear all filters"
              >
                <X size={11} className="inline mr-1" />
                Clear
              </button>
            </>
          )}
        </div>

        {totalSelectedOps > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
            <CheckCircle2 size={12} />
            {totalSelectedOps} file{totalSelectedOps !== 1 ? 's' : ''} selected across entries — use each entry's
            "Undo N" button to reverse.
          </div>
        )}
      </div>

      {/* List */}
      <div className="px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={20} />
          </div>
        ) : filteredEntries.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Clock size={32} />}
              title={entries.length === 0 ? 'No history yet' : 'No matches'}
              sub={
                entries.length === 0
                  ? 'Every file move is logged here and can be undone.'
                  : 'Try clearing filters or search.'
              }
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.label}>
                <h2 className="text-xs uppercase tracking-wider text-gray-600 font-semibold mb-3 flex items-center gap-2">
                  {group.label}
                  <span className="text-gray-700">({group.entries.length})</span>
                </h2>
                <div className="space-y-3">
                  {group.entries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      selectMode={selectMode}
                      entrySelected={selectedEntryIds.has(entry.id)}
                      onEntryToggle={() => toggleEntrySelected(entry.id)}
                      selectedOps={selectedOps.get(entry.id) ?? new Set()}
                      onOpToggle={(i) => toggleOp(entry.id, i)}
                      onEntryUndo={() => requestEntryUndo(entry)}
                      onPartialUndo={() => requestPartialUndo(entry)}
                      expanded={expandedIds.has(entry.id)}
                      onExpandToggle={() => toggleExpanded(entry.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {pendingUndo && (
        <UndoConfirmModal
          target={pendingUndo}
          onConfirm={() => runUndo(pendingUndo)}
          onCancel={() => setPendingUndo(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast {...toast} />}
    </div>
  );
}

function Toast({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  const color = kind === 'ok' ? 'emerald' : 'red';
  const Icon = kind === 'ok' ? CheckCircle2 : AlertCircle;
  const iconColor: Record<string, string> = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
  };
  const borderColor: Record<string, string> = {
    emerald: 'border-emerald-500/40',
    red: 'border-red-500/40',
  };
  return (
    <div
      role="status"
      className={`fixed bottom-6 right-6 bg-gray-900 border ${borderColor[color]} rounded-lg px-4 py-3 shadow-xl flex items-center gap-2 z-50`}
    >
      <Icon size={14} className={iconColor[color]} />
      <span className="text-sm text-gray-200">{text}</span>
    </div>
  );
}

