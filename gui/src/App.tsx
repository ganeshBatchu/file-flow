import { useState, useCallback } from 'react';
import { LayoutDashboard, FolderOpen, Tag, Clock, Settings } from 'lucide-react';
import Dashboard from './pages/Dashboard.tsx';
import FileBrowser from './pages/FileBrowser.tsx';
import Categories from './pages/Categories.tsx';
import History from './pages/History.tsx';
import SettingsPage from './pages/Settings.tsx';
import { useIPCEvents } from './hooks/useIPCEvents.ts';
import type { ActivityEvent } from './types/activity.ts';

type Page = 'dashboard' | 'files' | 'categories' | 'history' | 'settings';

const NAV = [
  { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'files' as Page, label: 'Files', icon: FolderOpen },
  { id: 'categories' as Page, label: 'Categories', icon: Tag },
  { id: 'history' as Page, label: 'History', icon: Clock },
  { id: 'settings' as Page, label: 'Settings', icon: Settings },
];

let eventSeq = 0;
const nextEventId = () => `${Date.now()}-${++eventSeq}`;

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useIPCEvents(useCallback((channel, msg) => {
    let evt: ActivityEvent | null = null;
    if (channel === 'activity:file-moved') {
      evt = {
        id: nextEventId(),
        kind: 'move',
        srcPath: String(msg.from ?? ''),
        destPath: String(msg.to ?? ''),
        ts: new Date(),
      };
    } else if (channel === 'activity:daemon-event') {
      const eventType = String(msg.eventType ?? 'event');
      evt = {
        id: nextEventId(),
        kind: eventType === 'move' || eventType === 'quarantine' || eventType === 'dedup' || eventType === 'error' || eventType === 'skip'
          ? eventType
          : 'event',
        srcPath: String(msg.path ?? ''),
        destPath: msg.destination ? String(msg.destination) : undefined,
        category: msg.category ? String(msg.category) : undefined,
        confidence: typeof msg.confidence === 'number' ? msg.confidence : undefined,
        error: msg.error ? String(msg.error) : undefined,
        ts: new Date(),
      };
    }
    // activity:dir-changed is intentionally NOT shown in the feed. That
    // channel exists to refresh the File Browser's listing when the watched
    // directory changes. Every daemon move fires an `unlink` on the source
    // path, which would flood the activity feed with bogus "REMOVED" rows
    // that mirror the real MOVE event we already display.
    if (evt) {
      const e = evt;
      setEvents(prev => [e, ...prev.slice(0, 199)]);
    }
  }, []));

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar */}
      <nav className="w-48 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Drag region — traffic lights sit ~70 px from left on macOS hiddenInset */}
        <div
          className="border-b border-gray-800 select-none"
          style={{ WebkitAppRegion: 'drag', paddingTop: 13, paddingBottom: 13, paddingLeft: 76, paddingRight: 16 } as React.CSSProperties}
        >
          <h1 className="text-lg font-bold text-white tracking-tight leading-none">FileFlow</h1>
          <p className="text-xs text-gray-500 mt-0.5">File Organizer</p>
        </div>
        <ul className="flex-1 py-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {NAV.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                onClick={() => setPage(id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  page === id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        {page === 'dashboard' && <Dashboard events={events} />}
        {page === 'files' && <FileBrowser />}
        {page === 'categories' && <Categories />}
        {page === 'history' && <History />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
