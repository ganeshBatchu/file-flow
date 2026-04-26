export type ActivityKind =
  | 'move'
  | 'quarantine'
  | 'dedup'
  | 'skip'
  | 'error'
  | 'change'
  | 'event';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  srcPath: string;
  destPath?: string;
  category?: string;
  confidence?: number;
  error?: string;
  changeType?: string;
  ts: Date;
}
