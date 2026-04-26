import { useEffect, useRef, useState } from 'react';
import { Save, Plus, Trash2, Settings, FolderOpen, Sliders, Shield, CheckCircle2, Loader2, Layers, Crown } from 'lucide-react';
import { api, type DirectoryGroup } from '../api.ts';
import { Card, Btn, Badge } from '../components/ui.tsx';

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800">
        <div className="p-1.5 bg-gray-800 rounded-lg">{icon}</div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </Card>
  );
}

function FieldLabel({ label, sub }: { label: string; sub?: string }) {
  return (
    <div>
      <p className="text-sm text-gray-300 font-medium">{label}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const exclusionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getConfig().then(cfg => { setConfig(cfg); setDirty(false); }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.setConfig(config);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { alert(`Save failed: ${(err as Error).message}`); }
    finally { setSaving(false); }
  };

  const set = (key: string, val: unknown) => {
    setConfig(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  };

  const watchDirs = (config.watch_directories as string[]) ?? [];
  const exclusions = (config.exclusions as string[]) ?? [];
  const threshold = (config.confidence_threshold as number) ?? 0.3;
  const maxSize = (config.max_file_size_mb as number) ?? 50;
  const groups = (config.directory_groups as DirectoryGroup[]) ?? [];

  // ── Directory-group editors ─────────────────────────────────────────
  // Mutate by index since the schema doesn't carry stable IDs. The list is
  // small (a typical user has 0–3 groups) so re-renders aren't a concern.
  const updateGroup = (idx: number, next: DirectoryGroup) => {
    const copy = groups.slice();
    copy[idx] = next;
    set('directory_groups', copy);
  };
  const removeGroup = (idx: number) => {
    set('directory_groups', groups.filter((_, i) => i !== idx));
  };
  const addGroup = () => {
    set('directory_groups', [...groups, { name: '', leader: '', members: [] }]);
  };
  const toggleMember = (idx: number, dir: string) => {
    const group = groups[idx];
    const isMember = group.members.includes(dir);
    const nextMembers = isMember
      ? group.members.filter((m) => m !== dir)
      : [...group.members, dir];
    // If we just removed the current leader, clear it; if there's no leader
    // yet and this is the first member, auto-promote it so the user has a
    // sensible default.
    let nextLeader = group.leader;
    if (isMember && dir === group.leader) nextLeader = '';
    if (!isMember && !group.leader && nextMembers.length === 1) nextLeader = dir;
    updateGroup(idx, { ...group, members: nextMembers, leader: nextLeader });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Sticky header + save bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-8 py-4 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center gap-3">
          <Settings size={18} className="text-gray-400" />
          <h1 className="text-xl font-semibold text-white">Settings</h1>
          {dirty && (
            <span className="text-xs text-amber-400 font-medium bg-amber-400/10 px-2 py-0.5 rounded-full">
              Unsaved changes
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> Saved</span>}
          <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
              : <><Save size={14} /> Save Settings</>}
          </Btn>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 max-w-2xl">

        {/* Watch directories */}
        <Section title="Watch Directories" icon={<FolderOpen size={14} className="text-blue-400" />}>
          <p className="text-xs text-gray-500">
            FileFlow will monitor these directories. The daemon and Organize Now only operate within these paths.
          </p>
          <div className="space-y-2">
            {watchDirs.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={d}
                  onChange={e => set('watch_directories', watchDirs.map((x, j) => j === i ? e.target.value : x))}
                  className="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm font-mono outline-none transition-colors"
                />
                <Btn variant="danger" size="sm" onClick={() => set('watch_directories', watchDirs.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </Btn>
              </div>
            ))}
          </div>
          <Btn variant="secondary" size="sm" onClick={() => set('watch_directories', [...watchDirs, ''])}>
            <Plus size={13} /> Add Directory
          </Btn>
        </Section>

        {/* Directory Groups */}
        <Section title="Directory Groups" icon={<Layers size={14} className="text-emerald-400" />}>
          <p className="text-xs text-gray-500">
            Bundle several watched directories under one <span className="text-gray-300 font-medium">leader</span>.
            Files arriving in any member route into the leader's category tree
            instead of being organized in place. Useful for funnelling Downloads
            and Desktop drops into Documents. Leave empty to organize each
            directory independently.
          </p>

          {groups.length === 0 && (
            <p className="text-xs text-gray-600 italic">No groups yet — every watched directory is organized in place.</p>
          )}

          {groups.map((group, gi) => {
            const memberSet = new Set(group.members);
            const nameInvalid = !group.name.trim();
            const noMembers = group.members.length === 0;
            const leaderMissing = group.members.length > 0 && !memberSet.has(group.leader);
            // Members not currently in `watch_directories` — let the user
            // remove them but show a hint they're orphaned.
            const orphanedMembers = group.members.filter((m) => !watchDirs.includes(m));

            return (
              <div key={gi} className="border border-gray-800 rounded-xl p-4 space-y-3 bg-gray-900/40">
                <div className="flex items-center gap-2">
                  <input
                    placeholder="Group name (e.g. Inbox)"
                    value={group.name}
                    onChange={(e) => updateGroup(gi, { ...group, name: e.target.value })}
                    className="flex-1 bg-gray-800 border border-gray-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm outline-none transition-colors"
                  />
                  <Btn variant="danger" size="sm" onClick={() => removeGroup(gi)}>
                    <Trash2 size={12} />
                  </Btn>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                    Members &amp; leader
                  </p>
                  {watchDirs.length === 0 ? (
                    <p className="text-xs text-gray-600">Add a watched directory above first.</p>
                  ) : (
                    <div className="space-y-1">
                      {watchDirs.map((dir) => {
                        const isMember = memberSet.has(dir);
                        const isLeader = group.leader === dir;
                        return (
                          <div
                            key={dir}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                              isMember ? 'bg-gray-800 border border-gray-700' : 'bg-gray-900 border border-transparent'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isMember}
                              onChange={() => toggleMember(gi, dir)}
                              className="accent-emerald-500"
                            />
                            <span className="flex-1 text-xs font-mono text-gray-200 truncate" title={dir}>{dir}</span>
                            {isMember && (
                              isLeader ? (
                                <Badge color="green">
                                  <span className="inline-flex items-center gap-1">
                                    <Crown size={10} /> Leader
                                  </span>
                                </Badge>
                              ) : (
                                <button
                                  onClick={() => updateGroup(gi, { ...group, leader: dir })}
                                  className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 hover:text-emerald-300 hover:border-emerald-600 transition-colors"
                                >
                                  Set as leader
                                </button>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {orphanedMembers.length > 0 && (
                  <div className="text-[11px] text-amber-400/90 bg-amber-400/5 border border-amber-500/20 rounded-lg px-3 py-2 space-y-1">
                    <p className="font-medium">Members not in Watch Directories:</p>
                    {orphanedMembers.map((m) => (
                      <div key={m} className="flex items-center gap-2">
                        <span className="font-mono truncate flex-1" title={m}>{m}</span>
                        <button
                          onClick={() =>
                            updateGroup(gi, {
                              ...group,
                              members: group.members.filter((x) => x !== m),
                              leader: group.leader === m ? '' : group.leader,
                            })
                          }
                          className="text-amber-300/80 hover:text-red-400"
                          title="Remove from group"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {(nameInvalid || noMembers || leaderMissing) && (
                  <div className="text-[11px] text-red-400 space-y-0.5">
                    {nameInvalid && <p>• Name is required.</p>}
                    {noMembers && <p>• Select at least one member directory.</p>}
                    {leaderMissing && <p>• Pick a leader from the checked members.</p>}
                  </div>
                )}
              </div>
            );
          })}

          <Btn variant="secondary" size="sm" onClick={addGroup}>
            <Plus size={13} /> New Group
          </Btn>
        </Section>

        {/* Exclusions */}
        <Section title="Exclusion Patterns" icon={<Shield size={14} className="text-amber-400" />}>
          <p className="text-xs text-gray-500">
            Glob patterns for files and folders to ignore (e.g.{' '}
            <span className="font-mono">node_modules</span>, <span className="font-mono">*.tmp</span>).
          </p>
          <div className="flex flex-wrap gap-2">
            {exclusions.map((ex, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
                <span className="text-xs font-mono text-gray-300">{ex}</span>
                <button
                  onClick={() => set('exclusions', exclusions.filter((_, j) => j !== i))}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              ref={exclusionInputRef}
              placeholder="e.g. *.log or build/"
              className="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm font-mono outline-none transition-colors"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) { set('exclusions', [...exclusions, val]); (e.target as HTMLInputElement).value = ''; }
                }
              }}
            />
            <Btn variant="secondary" size="sm" onClick={() => {
              const val = exclusionInputRef.current?.value.trim();
              if (val) { set('exclusions', [...exclusions, val]); exclusionInputRef.current!.value = ''; }
            }}>Add</Btn>
          </div>
        </Section>

        {/* Classification */}
        <Section title="Classification" icon={<Sliders size={14} className="text-purple-400" />}>
          <div>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel label="Confidence Threshold" sub="Files below this score go to Uncategorized" />
              <Badge color={threshold >= 0.5 ? 'green' : threshold >= 0.3 ? 'yellow' : 'red'}>
                {(threshold * 100).toFixed(0)}%
              </Badge>
            </div>
            <input
              type="range" min="0" max="1" step="0.05" value={threshold}
              onChange={e => set('confidence_threshold', parseFloat(e.target.value))}
              className="w-full accent-blue-500 h-2"
            />
            <div className="flex justify-between text-xs text-gray-700 mt-1">
              <span>0% (loose)</span><span>50%</span><span>100% (strict)</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel label="Max File Size for Content Extraction" sub="Larger files are classified by filename only" />
              <Badge color="gray">{maxSize} MB</Badge>
            </div>
            <input
              type="range" min="1" max="500" step="1" value={maxSize}
              onChange={e => set('max_file_size_mb', parseInt(e.target.value))}
              className="w-full accent-blue-500 h-2"
            />
            <div className="flex justify-between text-xs text-gray-700 mt-1">
              <span>1 MB</span><span>500 MB</span>
            </div>
          </div>
        </Section>

        <div className="pb-4" />
      </div>
    </div>
  );
}
