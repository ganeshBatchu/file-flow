import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Folder, FolderOpen, FolderPlus, Wand2, ChevronRight, ChevronDown,
  Move, X, RefreshCw, ArrowRight, FileText, FileCode, FileImage,
  File, CheckCircle2, AlertCircle, LayoutGrid, Copy, Pencil, GraduationCap,
  ScanSearch, Sparkles,
} from 'lucide-react';
import { api, type FileEntry, type PlannedMove, type DryRunPlan, type QuarantineItem } from '../api.ts';
import { useIPCEvents } from '../hooks/useIPCEvents.ts';
import { useScanProgress } from '../hooks/useScanProgress.ts';
import { Card, Btn, Badge, EmptyState, Spinner, ProgressBar } from '../components/ui.tsx';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function FileIcon({ name, size = 16 }: { name: string; size?: number }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext))
    return <FileText size={size} className="text-blue-400" />;
  if (['py', 'js', 'ts', 'rs', 'go', 'java', 'cpp', 'c'].includes(ext))
    return <FileCode size={size} className="text-purple-400" />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext))
    return <FileImage size={size} className="text-pink-400" />;
  return <File size={size} className="text-gray-500" />;
}

// ── Directory Tree ────────────────────────────────────────────
function DirTree({ rootDir, selected, onSelect }: {
  rootDir: string; selected: string; onSelect: (d: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootDir]));
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});

  const load = useCallback(async (dir: string) => {
    try {
      const entries = await api.listFiles(dir);
      setChildren(prev => ({ ...prev, [dir]: entries.filter(e => e.isDir) }));
    } catch {}
  }, []);

  useEffect(() => { load(rootDir); }, [rootDir, load]);

  const toggle = (dir: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else { next.add(dir); load(dir); }
      return next;
    });
  };

  function Node({ dir, depth }: { dir: string; depth: number }) {
    const name = dir.split('/').pop() ?? dir;
    const isExpanded = expanded.has(dir);
    const isSelected = selected === dir;
    const kids = children[dir] ?? [];

    return (
      <div>
        <div
          className={`flex items-center gap-2 py-1.5 cursor-pointer rounded-lg text-sm select-none transition-colors mx-1 ${
            isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          style={{ paddingLeft: `${10 + depth * 14}px`, paddingRight: '8px' }}
          onClick={() => { onSelect(dir); toggle(dir); }}
        >
          {isExpanded
            ? <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
            : <ChevronRight size={12} className="flex-shrink-0 opacity-60" />}
          {isSelected
            ? <FolderOpen size={14} className="flex-shrink-0" />
            : <Folder size={14} className="flex-shrink-0 text-blue-400" />}
          <span className="truncate font-medium">{name}</span>
        </div>
        {isExpanded && kids.map(k => <Node key={k.path} dir={k.path} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full py-2">
      <Node dir={rootDir} depth={0} />
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────
function PreviewModal({ plan, onConfirm, onCancel, onRescan }: {
  plan: DryRunPlan;
  onConfirm: (moves: PlannedMove[]) => void;
  onCancel: () => void;
  /** Re-run the preview after the user toggled subdirectory inclusion. */
  onRescan?: (include: string[], exclude: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(plan.moves.map((_, i) => i)));
  const [selectedQ, setSelectedQ] = useState<Set<number>>(new Set(plan.quarantine.map((_, i) => i)));
  // Per-row override: if a quarantine row has a closestCategory and the user
  // clicks "Move anyway", we flip that row to route to the close category
  // instead of Uncategorized. Keyed by index in plan.quarantine.
  const [overrideToClosest, setOverrideToClosest] = useState<Set<number>>(new Set());
  // Per-folder scan toggles, keyed by absolute path. Initialised from the
  // current scan's `scanned` field so a "no changes" state shows zero diff.
  const initialSubdirSelection = (): Set<string> =>
    new Set(plan.subdirectories.filter(s => s.scanned).map(s => s.path));
  const [subdirSelection, setSubdirSelection] = useState<Set<string>>(initialSubdirSelection);
  const [rescanning, setRescanning] = useState(false);
  // Reset state whenever the parent passes a new plan (after a re-scan
  // completes) — otherwise the selection set would diff against stale data.
  useEffect(() => {
    setSelected(new Set(plan.moves.map((_, i) => i)));
    setSelectedQ(new Set(plan.quarantine.map((_, i) => i)));
    setOverrideToClosest(new Set());
    setSubdirSelection(initialSubdirSelection());
  // We deliberately depend on `plan` identity — a fresh plan object means a
  // new scan completed and the user-facing selections should reset.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  const toggle = (i: number) => setSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const toggleQ = (i: number) => setSelectedQ(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const toggleSubdir = (path: string) => setSubdirSelection(prev => {
    const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n;
  });
  const toggleOverride = (i: number) => setOverrideToClosest(prev => {
    const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n;
  });
  const totalSelected = selected.size + selectedQ.size;

  // Diff the user's selection against the scan's actual `scanned` state to
  // compute the include/exclude lists for the next preview.
  const subdirDiff = (): { include: string[]; exclude: string[]; changed: boolean } => {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const s of plan.subdirectories) {
      const selectedNow = subdirSelection.has(s.path);
      if (selectedNow && !s.scanned) include.push(s.path);
      if (!selectedNow && s.scanned) exclude.push(s.path);
    }
    return { include, exclude, changed: include.length > 0 || exclude.length > 0 };
  };
  const { include: pendingInclude, exclude: pendingExclude, changed: hasSubdirChanges } = subdirDiff();

  const triggerRescan = async () => {
    if (!onRescan) return;
    setRescanning(true);
    try { await onRescan(pendingInclude, pendingExclude); }
    finally { setRescanning(false); }
  };

  const total = plan.moves.length + plan.quarantine.length;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="font-semibold text-lg text-white">Organize Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">{total} file{total !== 1 ? 's' : ''} will be processed</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Moves */}
          {plan.moves.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={14} className="text-emerald-400" />
                <h3 className="text-sm font-medium text-emerald-400">Will Move ({plan.moves.length})</h3>
                {plan.moves.some(m => m.confidence === 1.0) && (
                  <span className="flex items-center gap-1 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-md px-1.5 py-0.5">
                    <GraduationCap size={11} /> {plan.moves.filter(m => m.confidence === 1.0).length} course match{plan.moves.filter(m => m.confidence === 1.0).length !== 1 ? 'es' : ''}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {plan.moves.map((m, i) => {
                  const isCourse = m.confidence === 1.0;
                  return (
                    <label key={i} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors border ${
                      selected.has(i)
                        ? isCourse
                          ? 'bg-purple-500/5 border-purple-600/30'
                          : 'bg-emerald-500/5 border-emerald-600/30'
                        : 'bg-gray-800/50 border-gray-800'
                    }`}>
                      <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)}
                        className={`w-4 h-4 ${isCourse ? 'accent-purple-500' : 'accent-emerald-500'}`} />
                      <FileIcon name={m.srcPath} size={14} />
                      <span className="flex-1 text-sm font-mono truncate text-gray-200">
                        {m.srcPath.split('/').pop()}
                      </span>
                      <ArrowRight size={12} className="text-gray-600 flex-shrink-0" />
                      {isCourse ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/15 border border-purple-500/30 rounded-md text-xs text-purple-300 font-medium">
                          <GraduationCap size={11} /> {m.category}
                        </span>
                      ) : (
                        <Badge color="green">{m.category}</Badge>
                      )}
                      <span className={`text-xs w-10 text-right ${isCourse ? 'text-purple-400 font-semibold' : 'text-gray-500'}`}>
                        {isCourse ? '100%' : `${(m.confidence * 100).toFixed(0)}%`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Quarantine */}
          {plan.quarantine.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={14} className="text-amber-400" />
                <h3 className="text-sm font-medium text-amber-400">Low Confidence → Uncategorized ({plan.quarantine.length})</h3>
              </div>
              <p className="text-xs text-amber-600/70 mb-2">
                Check files to move them into the Uncategorized folder. Files with a close
                match show a suggestion you can accept with one click.
              </p>
              <div className="space-y-1.5">
                {plan.quarantine.map((q, i) => {
                  const hasClose = !!q.closestCategory && (q.confidence ?? 0) > 0;
                  const isOverridden = overrideToClosest.has(i);
                  const destName = isOverridden && q.closestCategory ? q.closestCategory : 'Uncategorized';
                  return (
                    <div
                      key={i}
                      className={`rounded-xl border transition-colors ${
                        selectedQ.has(i)
                          ? isOverridden
                            ? 'bg-blue-500/5 border-blue-600/30'
                            : 'bg-amber-500/5 border-amber-600/30'
                          : 'bg-gray-800/50 border-gray-800'
                      }`}
                    >
                      <label className="flex items-center gap-3 p-3 cursor-pointer">
                        <input type="checkbox" checked={selectedQ.has(i)} onChange={() => toggleQ(i)}
                          className={`w-4 h-4 ${isOverridden ? 'accent-blue-500' : 'accent-amber-500'}`} />
                        <FileIcon name={q.srcPath} size={14} />
                        <span className="text-sm font-mono text-gray-400 truncate flex-1">{q.srcPath.split('/').pop()}</span>
                        {q.needsOcr && (
                          <span
                            title="Image-only PDF — text couldn't be extracted. Run OCR first."
                            className="flex items-center gap-1 px-2 py-0.5 bg-rose-500/15 border border-rose-500/30 rounded-md text-xs text-rose-300 font-medium"
                          >
                            <ScanSearch size={11} /> needs OCR
                          </span>
                        )}
                        <ArrowRight size={12} className="text-gray-600 flex-shrink-0" />
                        <Badge color={isOverridden ? 'blue' : 'yellow'}>{destName}</Badge>
                      </label>
                      {hasClose && (
                        <div className="flex items-center gap-2 px-3 pb-2.5 pl-10">
                          <Sparkles size={11} className="text-blue-400 flex-shrink-0" />
                          <span className="text-xs text-gray-500 truncate">
                            Closest match: <span className="text-gray-300 font-medium">{q.closestCategory}</span>{' '}
                            <span className="text-gray-600">({((q.confidence ?? 0) * 100).toFixed(0)}%)</span>
                          </span>
                          <button
                            onClick={() => toggleOverride(i)}
                            className={`ml-auto text-xs px-2 py-0.5 rounded-md border transition-colors ${
                              isOverridden
                                ? 'bg-blue-500/20 border-blue-500/40 text-blue-200 hover:bg-blue-500/30'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                            }`}
                          >
                            {isOverridden ? 'Revert' : `Move to ${q.closestCategory}`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Duplicates */}
          {plan.duplicates.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Copy size={14} className="text-blue-400" />
                <h3 className="text-sm font-medium text-blue-400">Duplicates Skipped ({plan.duplicates.length})</h3>
              </div>
              <div className="space-y-1.5">
                {plan.duplicates.map((d, i) => (
                  <div key={i} className="p-3 rounded-xl bg-blue-500/5 border border-blue-600/20">
                    <p className="text-xs font-mono text-gray-400">{d.src.split('/').pop()}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Subdirectories — per-folder scan opt-in/out. By default the
              organizer touches only top-level files so preorganized folders
              stay untouched; toggling a row + Re-scan expands the scope. */}
          {plan.subdirectories.length > 0 && onRescan && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Folder size={14} className="text-blue-400" />
                <h3 className="text-sm font-medium text-blue-400">
                  Subdirectories ({plan.subdirectories.length})
                </h3>
              </div>
              <p className="text-xs text-blue-600/70 mb-2">
                Top-level files only by default — preorganized subfolders are skipped.
                Toggle any folder you want included, then Re-scan. Code projects are
                flagged and skipped unless you explicitly opt in.
              </p>
              <div className="space-y-1.5">
                {plan.subdirectories.map((s) => {
                  const isChecked = subdirSelection.has(s.path);
                  const changed = isChecked !== s.scanned;
                  return (
                    <label
                      key={s.path}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors border ${
                        changed
                          ? 'bg-blue-500/10 border-blue-500/40'
                          : isChecked
                            ? 'bg-gray-800/60 border-gray-700'
                            : 'bg-gray-800/30 border-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSubdir(s.path)}
                        className="w-4 h-4 accent-blue-500"
                      />
                      <Folder
                        size={14}
                        className={s.isCodeProject ? 'text-amber-400' : 'text-blue-400'}
                      />
                      <span className="flex-1 text-sm font-mono truncate text-gray-200">
                        {s.name}
                      </span>
                      {s.isCodeProject && (
                        <span
                          title="Looks like a code project root (e.g. has a .git or package.json). Opt in only if you really want files moved out of it."
                          className="px-2 py-0.5 bg-amber-500/15 border border-amber-500/30 rounded-md text-xs text-amber-300 font-medium"
                        >
                          code project
                        </span>
                      )}
                      {!s.scanned && !changed && <Badge color="yellow">skipped</Badge>}
                      {s.scanned && !changed && <Badge color="green">scanned</Badge>}
                      {changed && (
                        <Badge color="blue">{isChecked ? 'will scan' : 'will skip'}</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
              {hasSubdirChanges && (
                <div className="mt-3 flex items-center justify-end gap-3">
                  <span className="text-xs text-gray-500">
                    {pendingInclude.length > 0 && `+${pendingInclude.length} to scan`}
                    {pendingInclude.length > 0 && pendingExclude.length > 0 && ' · '}
                    {pendingExclude.length > 0 && `−${pendingExclude.length} to skip`}
                  </span>
                  <Btn
                    variant="secondary"
                    size="sm"
                    onClick={triggerRescan}
                    disabled={rescanning}
                  >
                    {rescanning ? <Spinner size={13} /> : <RefreshCw size={13} />}
                    Re-scan
                  </Btn>
                </div>
              )}
            </section>
          )}

          {total === 0 && plan.subdirectories.length === 0 && (
            <EmptyState icon={<LayoutGrid size={36} />} title="Nothing to organize" sub="All files are already in category folders." />
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <span className="text-xs text-gray-600">{totalSelected} of {plan.moves.length + plan.quarantine.length} selected</span>
          <div className="flex gap-3">
            <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
            <Btn
              variant="primary"
              onClick={() => {
                const confirmedMoves = plan.moves.filter((_, i) => selected.has(i));
                const quarantineMoves: PlannedMove[] = plan.quarantine
                  .map((q, i) => ({ q, i }))
                  .filter(({ i }) => selectedQ.has(i))
                  .map(({ q, i }) => {
                    // If the user clicked "Move anyway", route to the close
                    // category (parent of the file's dir + close category name).
                    if (overrideToClosest.has(i) && q.closestCategory) {
                      const parentDir = q.srcPath.substring(0, q.srcPath.lastIndexOf('/'));
                      return {
                        srcPath: q.srcPath,
                        destDir: `${parentDir}/${q.closestCategory}`,
                        category: q.closestCategory,
                        confidence: q.confidence ?? 0,
                      };
                    }
                    return {
                      srcPath: q.srcPath,
                      destDir: q.destDir,
                      category: 'Uncategorized',
                      confidence: 0,
                    };
                  });
                onConfirm([...confirmedMoves, ...quarantineMoves]);
              }}
              disabled={totalSelected === 0}
            >
              <CheckCircle2 size={14} /> Execute {totalSelected > 0 ? `(${totalSelected})` : ''}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── New Folder Modal ──────────────────────────────────────────
function NewFolderModal({ parentDir, onCreated, onCancel }: {
  parentDir: string; onCreated: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    if (!name.trim()) { setError('Name required'); return; }
    try { await api.mkdir(`${parentDir}/${name.trim()}`); onCreated(); }
    catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-96 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-blue-500/10 rounded-lg"><FolderPlus size={18} className="text-blue-400" /></div>
          <div>
            <h2 className="font-semibold text-white">New Folder</h2>
            <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{parentDir}/</p>
          </div>
        </div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
          placeholder="folder-name"
          className="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm font-mono outline-none transition-colors"
        />
        {error && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertCircle size={12} />{error}</p>}
        <div className="flex gap-3 mt-5">
          <Btn variant="secondary" onClick={onCancel} className="flex-1">Cancel</Btn>
          <Btn variant="primary" onClick={create} className="flex-1">Create</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Move Modal ────────────────────────────────────────────────
function MoveModal({ file, currentDir, onMoved, onCancel }: {
  file: FileEntry; currentDir: string; onMoved: () => void; onCancel: () => void;
}) {
  const [destDir, setDestDir] = useState('');
  const [subdirs, setSubdirs] = useState<FileEntry[]>([]);
  const [suggestion, setSuggestion] = useState<{ category: string | null; score: number } | null>(null);
  const [classifying, setClassifying] = useState(true);

  useEffect(() => {
    api.listFiles(currentDir).then(e => setSubdirs(e.filter(x => x.isDir))).catch(() => {});
    api.classify(file.path)
      .then(setSuggestion)
      .catch(() => {})
      .finally(() => setClassifying(false));
  }, [currentDir, file.path]);

  const move = async () => {
    if (!destDir) return;
    try { await api.moveFile(file.path, destDir); onMoved(); }
    catch (err) { alert(`Move failed: ${(err as Error).message}`); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-[420px] shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-purple-500/10 rounded-lg"><Move size={18} className="text-purple-400" /></div>
          <div>
            <h2 className="font-semibold text-white">Move File</h2>
            <p className="text-xs font-mono text-gray-400 truncate mt-0.5">{file.name}</p>
          </div>
          <button onClick={onCancel} className="ml-auto p-1.5 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-white"><X size={14} /></button>
        </div>

        {/* Suggestion */}
        {classifying ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500"><Spinner size={14} /> Classifying…</div>
        ) : suggestion?.category ? (
          <button
            onClick={() => setDestDir(`${currentDir}/${suggestion.category}`)}
            className={`w-full mb-4 flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
              destDir === `${currentDir}/${suggestion.category}`
                ? 'bg-blue-500/15 border-blue-500/40'
                : 'bg-blue-500/5 border-blue-600/20 hover:border-blue-500/40'
            }`}
          >
            <Wand2 size={14} className="text-blue-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-blue-300 font-medium">AI Suggestion</p>
              <p className="text-sm text-white">{suggestion.category}</p>
            </div>
            <Badge color="blue">{(suggestion.score * 100).toFixed(0)}% match</Badge>
          </button>
        ) : null}

        {/* Existing folders */}
        {subdirs.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 font-medium mb-2">Existing folders</p>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {subdirs.map(d => (
                <button
                  key={d.path}
                  onClick={() => setDestDir(d.path)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-mono text-left transition-colors border ${
                    destDir === d.path
                      ? 'bg-gray-700 border-gray-600 text-white'
                      : 'bg-gray-800/60 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                  }`}
                >
                  <Folder size={13} className="text-blue-400 flex-shrink-0" />{d.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manual path */}
        <div className="mb-5">
          <p className="text-xs text-gray-500 font-medium mb-2">Or enter path</p>
          <input
            value={destDir}
            onChange={e => setDestDir(e.target.value)}
            placeholder={`${currentDir}/my-folder`}
            className="w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm font-mono outline-none transition-colors"
          />
        </div>

        <div className="flex gap-3">
          <Btn variant="secondary" onClick={onCancel} className="flex-1">Cancel</Btn>
          <Btn variant="primary" onClick={move} disabled={!destDir} className="flex-1">
            <ArrowRight size={14} /> Move
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── File Card ─────────────────────────────────────────────────
function FileCard({ entry, onMove, onDragStart, onRenamed }: {
  entry: FileEntry;
  onMove: (f: FileEntry) => void;
  onDragStart: (f: FileEntry) => void;
  onRenamed: () => void;
}) {
  const [classification, setClassification] = useState<{ category: string | null; score: number } | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(entry.name);
  const [renameErr, setRenameErr] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const classify = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (classifying) return;
    setClassifying(true);
    try { setClassification(await api.classify(entry.path)); }
    catch {}
    finally { setClassifying(false); }
  };

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameVal(entry.name);
    setRenameErr('');
    setRenaming(true);
    setTimeout(() => { renameRef.current?.select(); }, 0);
  };

  const commitRename = async () => {
    if (renameVal.trim() === entry.name) { setRenaming(false); return; }
    try {
      await api.renameFile(entry.path, renameVal.trim());
      setRenaming(false);
      onRenamed();
    } catch (err) {
      setRenameErr((err as Error).message);
      renameRef.current?.select();
    }
  };

  const handleRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { setRenaming(false); setRenameErr(''); }
  };

  return (
    <div
      draggable={!renaming}
      onDragStart={() => !renaming && onDragStart(entry)}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 border-b border-gray-800/50 transition-colors"
      style={{ cursor: renaming ? 'default' : 'grab' }}
    >
      <div className="p-1.5 bg-gray-800 rounded-lg group-hover:bg-gray-700 transition-colors flex-shrink-0">
        <FileIcon name={entry.name} />
      </div>

      <div className="flex-1 min-w-0">
        {renaming ? (
          <div className="flex flex-col gap-1">
            <input
              ref={renameRef}
              value={renameVal}
              onChange={e => { setRenameVal(e.target.value); setRenameErr(''); }}
              onKeyDown={handleRenameKey}
              onBlur={commitRename}
              autoFocus
              className="w-full bg-gray-800 border border-blue-500 rounded-lg px-2 py-1 text-sm font-mono text-white outline-none"
              onClick={e => e.stopPropagation()}
            />
            {renameErr && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={10} /> {renameErr}
              </p>
            )}
            <p className="text-xs text-gray-600">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          <>
            <p
              className="text-sm text-gray-200 truncate font-medium cursor-text"
              onDoubleClick={startRename}
              title="Double-click to rename"
            >
              {entry.name}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">{formatSize(entry.size)}</p>
          </>
        )}
      </div>

      {!renaming && classification && (
        <Badge color={classification.category ? 'green' : 'yellow'}>
          {classification.category ?? 'Unclassified'}
          {classification.category && ` · ${(classification.score * 100).toFixed(0)}%`}
        </Badge>
      )}

      {!renaming && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={classify} disabled={classifying} title="Classify with AI"
            className="p-2 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-blue-400 transition-colors">
            {classifying ? <Spinner size={13} /> : <Wand2 size={13} />}
          </button>
          <button onClick={startRename} title="Rename file"
            className="p-2 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-amber-400 transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={() => onMove(entry)} title="Move to folder"
            className="p-2 hover:bg-gray-700 rounded-lg text-gray-500 hover:text-purple-400 transition-colors">
            <Move size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Folder Drop Target ────────────────────────────────────────
function FolderRow({ entry, onNavigate, onDrop, isDragOver, onDragOver, onDragLeave }: {
  entry: FileEntry;
  onNavigate: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  return (
    <div
      onClick={onNavigate}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-800/50 transition-all group ${
        isDragOver
          ? 'bg-blue-500/10 border-blue-500/30'
          : 'hover:bg-gray-800/60'
      }`}
    >
      <div className={`p-1.5 rounded-lg transition-colors ${isDragOver ? 'bg-blue-500/20' : 'bg-gray-800 group-hover:bg-gray-700'}`}>
        {isDragOver ? <FolderOpen size={16} className="text-blue-400" /> : <Folder size={16} className="text-blue-400" />}
      </div>
      <span className="text-sm font-medium text-gray-200 flex-1 truncate">{entry.name}</span>
      {isDragOver && <Badge color="blue">Drop here</Badge>}
      <ChevronRight size={14} className="text-gray-700 group-hover:text-gray-500 flex-shrink-0" />
    </div>
  );
}

// ── Main FileBrowser ──────────────────────────────────────────
export default function FileBrowser() {
  const [rootDir, setRootDir] = useState('');
  const [currentDir, setCurrentDir] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [draggedFile, setDraggedFile] = useState<FileEntry | null>(null);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [plan, setPlan] = useState<DryRunPlan | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const { visible: progressVisible, progress } = useScanProgress(organizing);

  useEffect(() => {
    api.getConfig().then((cfg: Record<string, unknown>) => {
      const dirs = (cfg.watch_directories as string[]) ?? [];
      if (dirs.length > 0) { setRootDir(dirs[0]); setCurrentDir(dirs[0]); }
    }).catch(() => {});
  }, []);

  const loadFiles = useCallback(async (dir: string) => {
    if (!dir) return;
    setLoading(true);
    try {
      const entries = await api.listFiles(dir);
      setFiles(entries.sort((a, b) => Number(b.isDir) - Number(a.isDir)));
      await api.watchDir(dir).catch(() => {});
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { if (currentDir) loadFiles(currentDir); }, [currentDir, loadFiles]);

  useIPCEvents(useCallback((channel, msg) => {
    if (channel === 'activity:dir-changed' && msg.dir === currentDir) loadFiles(currentDir);
    if (channel === 'activity:file-moved') loadFiles(currentDir);
  }, [currentDir, loadFiles]));

  const handleDrop = async (destDir: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverDir(null);
    if (!draggedFile || draggedFile.isDir) return;
    try { await api.moveFile(draggedFile.path, destDir); loadFiles(currentDir); }
    catch (err) { alert(`Drop failed: ${(err as Error).message}`); }
    setDraggedFile(null);
  };

  const handleOrganizeNow = async () => {
    setOrganizing(true);
    try { setPlan(await api.previewOrganize(currentDir)); }
    catch (err) { alert(`Preview failed: ${(err as Error).message}`); }
    finally { setOrganizing(false); }
  };

  // Re-scan from inside the preview modal: the user toggled which immediate
  // subdirectories to scan, so we re-run the preview with their selection.
  // Returns a fresh plan; the modal resets its selection state in a useEffect
  // keyed on plan identity.
  const rescanWithSubdirs = async (
    include: string[],
    exclude: string[],
  ) => {
    try {
      const next = await api.previewOrganize(currentDir, {
        includeSubdirectories: include,
        excludeSubdirectories: exclude,
      });
      setPlan(next);
    } catch (err) {
      alert(`Re-scan failed: ${(err as Error).message}`);
    }
  };

  const executeOrganize = async (moves: PlannedMove[]) => {
    try {
      const result = await api.executeOrganize(moves) as { moved: unknown[]; errors: { path: string; error: string }[] } | undefined;
      const movedCount = result?.moved?.length ?? 0;
      const errorCount = result?.errors?.length ?? 0;
      alert(`Moved ${movedCount} file${movedCount === 1 ? '' : 's'}. ${errorCount} error${errorCount === 1 ? '' : 's'}.`);
    } catch (err) { alert(`Organize failed: ${(err as Error).message}`); }
    setPlan(null);
    loadFiles(currentDir);
  };

  // Breadcrumb parts
  const breadcrumbs = currentDir.replace(rootDir, '').split('/').filter(Boolean);

  const dirs = files.filter(f => f.isDir);
  const fileEntries = files.filter(f => !f.isDir);

  if (!rootDir) return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
      <div className="p-4 bg-gray-800 rounded-2xl"><FolderOpen size={32} className="text-gray-600" /></div>
      <p className="text-gray-400 font-medium">No directories configured</p>
      <p className="text-gray-600 text-sm">Go to Settings and add a watch directory to get started.</p>
    </div>
  );

  return (
    <div className="h-full flex overflow-hidden">
      {/* Dir tree */}
      <div className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Folders</p>
        </div>
        <div className="flex-1 overflow-hidden">
          <DirTree rootDir={rootDir} selected={currentDir} onSelect={setCurrentDir} />
        </div>
      </div>

      {/* Main file area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800 bg-gray-900">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
            <button onClick={() => setCurrentDir(rootDir)} className="text-gray-500 hover:text-white transition-colors font-mono text-xs">
              {rootDir.split('/').pop()}
            </button>
            {breadcrumbs.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight size={12} className="text-gray-700" />
                <span className="text-gray-300 font-mono text-xs">{part}</span>
              </span>
            ))}
          </div>

          <Btn variant="ghost" size="sm" onClick={() => loadFiles(currentDir)} title="Refresh"><RefreshCw size={13} /></Btn>
          <Btn variant="secondary" size="sm" onClick={() => setShowNewFolder(true)}>
            <FolderPlus size={13} /> New Folder
          </Btn>
          <Btn variant="primary" size="sm" onClick={handleOrganizeNow} disabled={organizing}>
            {organizing ? <Spinner size={13} /> : <Wand2 size={13} />}
            Organize Now
          </Btn>
        </div>

        {/* Progress bar — appears only after Organize Now has run for >3s */}
        {progressVisible && progress && (
          <div className="px-4 py-3 border-b border-gray-800 bg-gray-950">
            <ProgressBar
              label="Building organize preview"
              current={progress.current}
              total={progress.total}
              currentFile={progress.currentFile}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={20} />
            </div>
          ) : (
            <>
              {/* Folders */}
              {dirs.length > 0 && (
                <div className="border-b border-gray-800">
                  {dirs.map(d => (
                    <FolderRow
                      key={d.path}
                      entry={d}
                      onNavigate={() => setCurrentDir(d.path)}
                      isDragOver={dragOverDir === d.path}
                      onDragOver={e => { e.preventDefault(); setDragOverDir(d.path); }}
                      onDragLeave={() => setDragOverDir(null)}
                      onDrop={e => handleDrop(d.path, e)}
                    />
                  ))}
                </div>
              )}

              {/* Files */}
              {fileEntries.length > 0 ? (
                fileEntries.map(f => (
                  <FileCard key={f.path} entry={f} onMove={setMoveTarget} onDragStart={setDraggedFile} onRenamed={() => loadFiles(currentDir)} />
                ))
              ) : dirs.length === 0 ? (
                <EmptyState icon={<File size={32} />} title="Empty folder" sub="Drop files here or click Organize Now" />
              ) : null}
            </>
          )}
        </div>

        {/* Drag hint */}
        {draggedFile && (
          <div className="px-4 py-2 bg-blue-600/10 border-t border-blue-600/20 text-xs text-blue-300 text-center">
            Drop <strong>{draggedFile.name}</strong> onto a folder above
          </div>
        )}
      </div>

      {showNewFolder && (
        <NewFolderModal parentDir={currentDir} onCreated={() => { setShowNewFolder(false); loadFiles(currentDir); }} onCancel={() => setShowNewFolder(false)} />
      )}
      {moveTarget && (
        <MoveModal file={moveTarget} currentDir={currentDir} onMoved={() => { setMoveTarget(null); loadFiles(currentDir); }} onCancel={() => setMoveTarget(null)} />
      )}
      {plan && (
        <PreviewModal
          plan={plan}
          onConfirm={executeOrganize}
          onCancel={() => setPlan(null)}
          onRescan={rescanWithSubdirs}
        />
      )}
    </div>
  );
}

