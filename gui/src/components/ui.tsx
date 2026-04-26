import { type ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl ${className}`}>
      {children}
    </div>
  );
}

export function Btn({
  children, onClick, disabled, variant = 'primary', size = 'md', className = '', title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}) {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500',
    secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700',
    danger: 'bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/40',
    ghost: 'hover:bg-gray-800 text-gray-400 hover:text-white border border-transparent',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2.5',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color = 'blue' }: { children: ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    yellow: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    red: 'bg-red-500/15 text-red-300 border-red-500/30',
    gray: 'bg-gray-700/50 text-gray-400 border-gray-600/50',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${colors[color] ?? colors.blue}`}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-3xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </Card>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-gray-700 mb-3">{icon}</div>
      <p className="text-gray-400 font-medium">{title}</p>
      {sub && <p className="text-gray-600 text-sm mt-1">{sub}</p>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-blue-400" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Determinate progress bar with current/total counter and optional current
 * filename. Shown as a Card so it can sit inline in any page layout.
 */
export function ProgressBar({
  current, total, currentFile, label, className = '',
}: {
  current: number;
  total: number;
  currentFile?: string;
  label?: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const filename = currentFile ? currentFile.split('/').pop() ?? '' : '';
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Spinner size={13} />
          <p className="text-sm font-medium text-white">{label ?? 'Working…'}</p>
        </div>
        <p className="text-xs text-gray-500 font-mono tabular-nums">
          {current} / {total} <span className="text-gray-600">·</span> {pct}%
        </p>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {filename && (
        <p className="text-xs text-gray-600 font-mono mt-2 truncate" title={currentFile}>
          {filename}
        </p>
      )}
    </Card>
  );
}
