import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, RefreshCw, Folder, Tag, Plus, X, CheckCircle2, Pencil, GraduationCap, Check } from 'lucide-react';
import { api, type CategoryConfig, type SuggestedCategory } from '../api.ts';
import { Card, Btn, Badge, EmptyState, Spinner, ProgressBar } from '../components/ui.tsx';
import { useScanProgress } from '../hooks/useScanProgress.ts';

const CATEGORY_COLORS = ['blue', 'green', 'purple', 'yellow', 'red'];
const BORDER_COLORS: Record<string, string> = {
  blue: 'border-l-blue-500',
  green: 'border-l-emerald-500',
  purple: 'border-l-purple-500',
  yellow: 'border-l-amber-500',
  red: 'border-l-red-500',
};
const DOT_COLORS: Record<string, string> = {
  blue: 'bg-blue-400',
  green: 'bg-emerald-400',
  purple: 'bg-purple-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
};

function getCategoryColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

// Matches normalised course folder names like "CS 3100", "MATH 1365", "BIOL 1234W"
const COURSE_NAME_RE = /^[A-Z]{2,6} \d{3,4}[A-Z]{0,2}$/;
function isCourseCategory(name: string): boolean {
  return COURSE_NAME_RE.test(name);
}
function isEmptyCategory(cat: CategoryConfig): boolean {
  return cat.keywords.length === 0 && cat.centroid.length === 0;
}

function DeleteConfirmModal({ names, onConfirm, onCancel }: {
  names: string[]; onConfirm: () => void; onCancel: () => void;
}) {
  const count = names.length;
  const title = count === 1 ? 'Delete Category?' : `Delete ${count} Categories?`;
  const preview = names.slice(0, 5);
  const overflow = count - preview.length;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-96 shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-red-500/10 rounded-lg"><Trash2 size={16} className="text-red-400" /></div>
          <h2 className="font-semibold text-white">{title}</h2>
        </div>
        {count === 1 ? (
          <p className="text-sm text-gray-400 mb-5">
            <strong className="text-white">"{names[0]}"</strong> will be removed. Files in this category folder won't be moved.
          </p>
        ) : (
          <div className="mb-5">
            <p className="text-sm text-gray-400 mb-3">
              The following categories will be removed. Files in these folders won't be moved.
            </p>
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 max-h-40 overflow-y-auto">
              <ul className="space-y-1">
                {preview.map(n => (
                  <li key={n} className="text-xs font-mono text-gray-300 truncate">{n}</li>
                ))}
                {overflow > 0 && (
                  <li className="text-xs text-gray-600 italic">…and {overflow} more</li>
                )}
              </ul>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <Btn variant="secondary" onClick={onCancel} className="flex-1">Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm} className="flex-1">
            <Trash2 size={13} /> Delete{count > 1 ? ` ${count}` : ''}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({ s, onSave, onDismiss }: {
  s: SuggestedCategory; onSave: () => void; onDismiss: () => void;
}) {
  const isCourse = isCourseCategory(s.name);
  const color = isCourse ? 'purple' : getCategoryColor(s.name);
  return (
    <div className={`bg-gray-900 border border-gray-800 border-l-4 ${BORDER_COLORS[color]} rounded-xl p-4`}>
      <div className="flex items-start gap-3">
        <div className="p-1.5 bg-gray-800 rounded-lg mt-0.5">
          {isCourse
            ? <GraduationCap size={14} className="text-purple-400" />
            : <Folder size={14} className="text-blue-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium text-white text-sm">{s.name}</p>
            {isCourse && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-1.5 py-0.5">
                Course
              </span>
            )}
            <Badge color="gray">{s.fileCount} file{s.fileCount !== 1 ? 's' : ''}</Badge>
          </div>
          {isCourse ? (
            <p className="text-xs text-purple-300/70">
              Auto-matched from course number pattern · no keywords needed
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {s.keywords.slice(0, 6).map(kw => (
                <span key={kw} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-md font-mono">{kw}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <Btn variant="success" size="sm" onClick={onSave}><CheckCircle2 size={12} /> Save</Btn>
          <Btn variant="ghost" size="sm" onClick={onDismiss}><X size={12} /></Btn>
        </div>
      </div>
    </div>
  );
}

/** Square checkbox for multi-select. */
function SelectBox({ checked, onChange, className = '' }: {
  checked: boolean; onChange: (e: React.MouseEvent) => void; className?: string;
}) {
  return (
    <button
      onClick={onChange}
      aria-checked={checked}
      role="checkbox"
      className={`flex-shrink-0 w-4 h-4 rounded border transition-all flex items-center justify-center ${
        checked
          ? 'bg-blue-500 border-blue-400'
          : 'bg-gray-900 border-gray-600 hover:border-gray-400'
      } ${className}`}
    >
      {checked && <Check size={11} className="text-white" strokeWidth={3} />}
    </button>
  );
}

function CategoryCard({
  name, cat, selected, onToggleSelect, onDelete, onRenamed, selectionActive, anySelected,
}: {
  name: string;
  cat: CategoryConfig;
  selected: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onRenamed: () => void;
  selectionActive: boolean;
  anySelected: boolean;
}) {
  const isCourse = isCourseCategory(name);
  const color = isCourse ? 'purple' : getCategoryColor(name);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(name);
  const [editErr, setEditErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditVal(name);
    setEditErr('');
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commitEdit = async () => {
    const trimmed = editVal.trim();
    if (trimmed === name) { setEditing(false); return; }
    try {
      await api.renameCategory(name, trimmed);
      setEditing(false);
      onRenamed();
    } catch (err) {
      setEditErr((err as Error).message);
      inputRef.current?.select();
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditing(false); setEditErr(''); }
  };

  // When selection mode is active, clicking the card body toggles selection.
  const handleCardClick = (e: React.MouseEvent) => {
    if (!selectionActive || editing) return;
    const target = e.target as HTMLElement;
    // Don't toggle if user clicked an interactive element inside.
    if (target.closest('button, input, a')) return;
    onToggleSelect(e);
  };

  const selectedRing = selected ? 'ring-2 ring-blue-500/60 border-blue-500/40' : 'border-gray-800 hover:border-gray-700';

  return (
    <div
      onClick={handleCardClick}
      className={`bg-gray-900 border border-l-4 ${BORDER_COLORS[color]} ${selectedRing} rounded-xl p-4 group transition-colors ${selectionActive && !editing ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox: always shown when any selection is active, else on hover */}
        <div className={`pt-1 flex-shrink-0 transition-opacity ${anySelected || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <SelectBox checked={selected} onChange={onToggleSelect} />
        </div>
        {isCourse ? (
          <GraduationCap size={16} className="text-purple-400 mt-1 flex-shrink-0" />
        ) : (
          <div className={`w-2 h-2 rounded-full ${DOT_COLORS[color]} mt-2 flex-shrink-0`} />
        )}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="mb-2">
              <input
                ref={inputRef}
                value={editVal}
                onChange={e => { setEditVal(e.target.value); setEditErr(''); }}
                onKeyDown={handleKey}
                onBlur={commitEdit}
                autoFocus
                className="w-full bg-gray-800 border border-blue-500 rounded-lg px-2 py-1 text-sm font-semibold text-white outline-none"
                onClick={e => e.stopPropagation()}
              />
              {editErr
                ? <p className="text-xs text-red-400 mt-1">{editErr}</p>
                : <p className="text-xs text-gray-600 mt-1">Enter to save · Esc to cancel</p>}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 mb-2 group/title">
              <p className="font-semibold text-white text-sm">{name}</p>
              {isCourse && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-1.5 py-0.5">
                  Course
                </span>
              )}
              {isEmptyCategory(cat) && !isCourse && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5">
                  Empty
                </span>
              )}
              <button
                onClick={startEdit}
                className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-gray-700 rounded text-gray-600 hover:text-amber-400 transition-all"
                title="Rename category"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}
          {isCourse ? (
            <p className="text-xs text-purple-300/70">
              Auto-matched from course number pattern · no keywords needed
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {cat.keywords.slice(0, 8).map(kw => (
                <span key={kw} className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-md font-mono hover:text-gray-300 transition-colors">
                  {kw}
                </span>
              ))}
              {cat.keywords.length > 8 && (
                <span className="text-xs text-gray-600 px-2 py-0.5">+{cat.keywords.length - 8} more</span>
              )}
            </div>
          )}
        </div>
        {!editing && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 rounded-lg text-gray-600 hover:text-red-400 transition-all"
            title="Delete category"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

type FilterKey = 'courses' | 'custom' | 'empty';

function SelectionToolbar({
  selectedCount, totalCount, allVisible, onSelectAll, onClear, onDelete, onSelectFilter, deleting,
}: {
  selectedCount: number;
  totalCount: number;
  allVisible: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onSelectFilter: (filter: FilterKey) => void;
  deleting: boolean;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-8 px-8 py-3 bg-gray-950/95 backdrop-blur border-b border-gray-800 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="blue">
          {selectedCount} selected
        </Badge>
        <span className="text-xs text-gray-600">of {totalCount}</span>
        <div className="w-px h-5 bg-gray-800 mx-1" />
        <button
          onClick={onSelectAll}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors"
        >
          {allVisible ? 'Deselect all' : 'Select all'}
        </button>
        <div className="w-px h-5 bg-gray-800 mx-1" />
        <span className="text-xs text-gray-600">Quick select:</span>
        <button
          onClick={() => onSelectFilter('courses')}
          className="text-xs text-purple-300 hover:text-purple-200 px-2 py-1 rounded hover:bg-purple-500/10 transition-colors"
        >
          Courses
        </button>
        <button
          onClick={() => onSelectFilter('custom')}
          className="text-xs text-blue-300 hover:text-blue-200 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
        >
          Non-courses
        </button>
        <button
          onClick={() => onSelectFilter('empty')}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors"
        >
          Empty
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="ghost" size="sm" onClick={onClear}>
            <X size={12} /> Clear
          </Btn>
          <Btn variant="danger" size="sm" onClick={onDelete} disabled={selectedCount === 0 || deleting}>
            {deleting ? <Spinner size={12} /> : <Trash2 size={12} />}
            Delete {selectedCount}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export default function Categories() {
  const [cats, setCats] = useState<Record<string, CategoryConfig>>({});
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedCategory[]>([]);
  const [scanDir, setScanDir] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const { visible: progressVisible, progress } = useScanProgress(scanning);

  const refresh = async () => {
    try { setCats(await api.getCategories()); } catch {}
  };

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.getCategories().then(setCats),
      api.getConfig().then(cfg => {
        const dirs = (cfg.watch_directories as string[]) ?? [];
        if (dirs.length) setScanDir(dirs[0]);
      }),
    ]).finally(() => setLoading(false));
  }, []);

  // Escape clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected.size > 0 && !pendingDelete) {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, pendingDelete]);

  // Purge selections that no longer exist after refresh
  useEffect(() => {
    if (selected.size === 0) return;
    const existing = new Set(Object.keys(cats));
    const next = new Set<string>();
    let changed = false;
    for (const n of selected) {
      if (existing.has(n)) next.add(n);
      else changed = true;
    }
    if (changed) setSelected(next);
  }, [cats]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    if (!scanDir) return;
    setScanning(true);
    try { setSuggestions(await api.scanCategories(scanDir, 5)); }
    catch (err) { alert(`Scan failed: ${(err as Error).message}`); }
    finally { setScanning(false); }
  };

  const saveSuggestion = async (s: SuggestedCategory) => {
    try {
      await api.saveCategory(s.name, s.keywords, s.centroid);
      setSuggestions(prev => prev.filter(x => x.name !== s.name));
      await refresh();
    } catch (err) { alert((err as Error).message); }
  };

  const catList = useMemo(
    () => Object.entries(cats).sort(([a], [b]) => a.localeCompare(b)),
    [cats]
  );
  const catNames = useMemo(() => catList.map(([n]) => n), [catList]);

  const toggleOne = (name: string, shift: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      // Shift-click: range select between last clicked and this one
      if (shift && lastClicked && lastClicked !== name) {
        const from = catNames.indexOf(lastClicked);
        const to = catNames.indexOf(name);
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          // Use the TARGET state from the current item (after toggle) to unify the range
          const addMode = !prev.has(name);
          for (let i = lo; i <= hi; i++) {
            if (addMode) next.add(catNames[i]);
            else next.delete(catNames[i]);
          }
          return next;
        }
      }
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setLastClicked(name);
  };

  const selectFilter = (filter: FilterKey) => {
    const next = new Set<string>();
    for (const [name, cat] of catList) {
      if (filter === 'courses' && isCourseCategory(name)) next.add(name);
      else if (filter === 'custom' && !isCourseCategory(name)) next.add(name);
      else if (filter === 'empty' && isEmptyCategory(cat)) next.add(name);
    }
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === catList.length) setSelected(new Set());
    else setSelected(new Set(catNames));
  };

  const requestDeleteSingle = (name: string) => setPendingDelete([name]);
  const requestDeleteSelected = () => {
    if (selected.size === 0) return;
    setPendingDelete([...selected]);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || pendingDelete.length === 0) return;
    setDeleting(true);
    try {
      if (pendingDelete.length === 1) {
        await api.deleteCategory(pendingDelete[0]);
      } else {
        await api.deleteCategories(pendingDelete);
      }
      const removed = new Set(pendingDelete);
      setSelected(prev => {
        const next = new Set<string>();
        for (const n of prev) if (!removed.has(n)) next.add(n);
        return next;
      });
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const anySelected = selected.size > 0;
  const allVisible = selected.size === catList.length && catList.length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 pt-8 pb-6 border-b border-gray-800">
        <div className="flex items-center gap-3 mb-1">
          <Tag size={20} className="text-purple-400" />
          <h1 className="text-xl font-semibold text-white">Categories</h1>
          {catList.length > 0 && <Badge color="gray">{catList.length}</Badge>}
        </div>
        <p className="text-sm text-gray-500">
          Manage how files are classified and organized
          {catList.length > 1 && <span className="text-gray-600"> · Shift-click to range-select · Esc to clear</span>}
        </p>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Scan card */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 bg-blue-500/10 rounded-lg"><Plus size={14} className="text-blue-400" /></div>
            <h3 className="text-sm font-semibold text-white">Suggest Categories from Directory</h3>
          </div>
          <div className="flex gap-2">
            <input
              value={scanDir}
              onChange={e => setScanDir(e.target.value)}
              placeholder="/path/to/directory"
              className="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm font-mono outline-none transition-colors"
            />
            <Btn variant="primary" onClick={scan} disabled={scanning || !scanDir}>
              {scanning ? <Spinner size={14} /> : <RefreshCw size={14} />}
              Scan
            </Btn>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            FileFlow detects course numbers (e.g. <span className="font-mono text-purple-400/80">CS 3100</span>) first, then suggests categories from content clusters for the rest.
          </p>
        </Card>

        {/* Progress bar — appears only after a scan has run for >3s */}
        {progressVisible && progress && (
          <ProgressBar
            label="Scanning files for category suggestions"
            current={progress.current}
            total={progress.total}
            currentFile={progress.currentFile}
          />
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Suggestions</h3>
              <button onClick={() => setSuggestions([])} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                Clear all
              </button>
            </div>
            <div className="space-y-2.5">
              {suggestions.map(s => (
                <SuggestionCard
                  key={s.name}
                  s={s}
                  onSave={() => saveSuggestion(s)}
                  onDismiss={() => setSuggestions(prev => prev.filter(x => x.name !== s.name))}
                />
              ))}
            </div>
          </div>
        )}

        {/* Existing categories */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Your Categories</h3>
            <Btn variant="ghost" size="sm" onClick={refresh}><RefreshCw size={12} /></Btn>
          </div>

          {anySelected && (
            <SelectionToolbar
              selectedCount={selected.size}
              totalCount={catList.length}
              allVisible={allVisible}
              onSelectAll={toggleSelectAll}
              onClear={() => setSelected(new Set())}
              onDelete={requestDeleteSelected}
              onSelectFilter={selectFilter}
              deleting={deleting}
            />
          )}

          {loading ? (
            <Card>
              <div className="flex items-center justify-center py-12">
                <Spinner size={20} />
              </div>
            </Card>
          ) : catList.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Tag size={32} />}
                title="No categories yet"
                sub="Scan a directory above to get suggestions, or files will go to Uncategorized."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {catList.map(([name, cat]) => (
                <CategoryCard
                  key={name}
                  name={name}
                  cat={cat}
                  selected={selected.has(name)}
                  onToggleSelect={(e) => toggleOne(name, e.shiftKey)}
                  onDelete={() => requestDeleteSingle(name)}
                  onRenamed={refresh}
                  selectionActive={anySelected}
                  anySelected={anySelected}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <DeleteConfirmModal
          names={pendingDelete}
          onConfirm={confirmDelete}
          onCancel={() => { if (!deleting) setPendingDelete(null); }}
        />
      )}
    </div>
  );
}
