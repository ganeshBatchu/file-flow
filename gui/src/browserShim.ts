/**
 * When running in a browser (not Electron), inject a mock window.fileflow
 * so the renderer renders without crashing. Returns empty/default data.
 */
const isElectron = typeof window !== 'undefined' &&
  typeof (window as unknown as Record<string, unknown>).fileflow !== 'undefined';

if (!isElectron) {
  const mockConfig = {
    watch_directories: ['/Users/demo/fileflow-sandbox'],
    exclusions: ['node_modules', '.git', '*.tmp'],
    categories: {
      'research-papers': { keywords: ['neural', 'network', 'abstract'], centroid: [] },
      'tax-documents': { keywords: ['w2', '1099', 'deduction'], centroid: [] },
    },
    confidence_threshold: 0.3,
    uncategorized_folder: 'Uncategorized',
    max_file_size_mb: 50,
    directory_groups: [] as { name: string; leader: string; members: string[] }[],
    daemon: { debounce_seconds: 2, log_level: 'info', log_max_size_mb: 10, auto_start: false },
    duplicates: { default_action: 'prompt', hash_cache_path: '' },
    journal_path: '',
    max_journal_entries: 500,
  };

  const mockFiles = [
    { name: 'paper.pdf', path: '/Users/demo/fileflow-sandbox/paper.pdf', isDir: false, size: 245000, mtime: Date.now() - 3600000 },
    { name: 'w2_2024.pdf', path: '/Users/demo/fileflow-sandbox/w2_2024.pdf', isDir: false, size: 98000, mtime: Date.now() - 7200000 },
    { name: 'recipe.txt', path: '/Users/demo/fileflow-sandbox/recipe.txt', isDir: false, size: 1200, mtime: Date.now() - 900000 },
    { name: 'model.py', path: '/Users/demo/fileflow-sandbox/model.py', isDir: false, size: 8400, mtime: Date.now() - 1800000 },
    { name: 'research-papers', path: '/Users/demo/fileflow-sandbox/research-papers', isDir: true, size: 0, mtime: Date.now() },
    { name: 'tax-documents', path: '/Users/demo/fileflow-sandbox/tax-documents', isDir: true, size: 0, mtime: Date.now() },
  ];

  (window as unknown as Record<string, unknown>).fileflow = {
    invoke: async (channel: string, ..._args: unknown[]) => {
      await new Promise(r => setTimeout(r, 120)); // fake latency
      switch (channel) {
        case 'config:get': return mockConfig;
        case 'config:set': return;
        case 'files:list': return mockFiles;
        case 'files:mkdir': return;
        case 'files:move': return { from: '', to: '', action: 'moved' };
        case 'files:watch': return;
        case 'classify:file': return { category: 'research-papers', score: 0.74 };
        case 'organize:preview': return {
          moves: [
            { srcPath: '/Users/demo/fileflow-sandbox/paper.pdf', destDir: '/Users/demo/fileflow-sandbox/research-papers', category: 'research-papers', confidence: 0.82 },
            { srcPath: '/Users/demo/fileflow-sandbox/w2_2024.pdf', destDir: '/Users/demo/fileflow-sandbox/tax-documents', category: 'tax-documents', confidence: 0.91 },
          ],
          quarantine: ['/Users/demo/fileflow-sandbox/recipe.txt'],
          duplicates: [],
          errors: [],
          subdirectories: [
            { path: '/Users/demo/fileflow-sandbox/research-papers', name: 'research-papers', scanned: false, isCodeProject: false },
            { path: '/Users/demo/fileflow-sandbox/tax-documents', name: 'tax-documents', scanned: false, isCodeProject: false },
          ],
        };
        case 'organize:execute': return { moved: [], errors: [] };
        case 'categories:list': return mockConfig.categories;
        case 'categories:scan': return [
          { name: 'research-papers', keywords: ['neural', 'network'], centroid: [], fileCount: 3 },
          { name: 'tax-documents', keywords: ['w2', '1099'], centroid: [], fileCount: 2 },
        ];
        case 'categories:save': return;
        case 'categories:delete': return;
        case 'categories:deleteMany': {
          const names = (_args[0] as string[]) ?? [];
          return { deleted: names.length, missing: [] };
        }
        case 'quarantine:list': return ['/Users/demo/fileflow-sandbox/recipe.txt'];
        case 'history:query': return [
          { id: 'op_1', timestamp: new Date().toISOString(), operations: [{ type: 'move', from: '/Users/demo/paper.pdf', to: '/Users/demo/research-papers/paper.pdf' }], category: 'research-papers', confidence: 0.82 },
        ];
        case 'undo:last': return { reversed: [], errors: [] };
        case 'undo:by-id': return { reversed: [], errors: [] };
        case 'daemon:status': return { running: false, watchedPaths: ['/Users/demo/fileflow-sandbox'] };
        case 'daemon:start': return;
        case 'daemon:stop': return;
        default: return null;
      }
    },
    on: (_channel: string, _listener: unknown) => () => {},
    off: () => {},
  };
}
