/**
 * Debounces file events so that rapid writes (partial writes, temp files)
 * are coalesced into a single event after the file appears stable.
 */
export class FileDebouncer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private delayMs: number;
  private callback: (filePath: string) => void;

  constructor(delaySeconds: number, callback: (filePath: string) => void) {
    this.delayMs = delaySeconds * 1000;
    this.callback = callback;
  }

  /**
   * Schedule processing of a file. Resets the timer if the file
   * was already pending.
   */
  schedule(filePath: string): void {
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      this.callback(filePath);
    }, this.delayMs);

    this.timers.set(filePath, timer);
  }

  /**
   * Cancel a pending file event.
   */
  cancel(filePath: string): void {
    const existing = this.timers.get(filePath);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(filePath);
    }
  }

  /**
   * Cancel all pending timers.
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  get pendingCount(): number {
    return this.timers.size;
  }
}
