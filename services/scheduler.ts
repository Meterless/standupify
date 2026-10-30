
// =====================================================================
// Scheduler interface — the v2 cloud bridge for the Night Shift loop.
//
// v1: a simple `setInterval` tick. The interface is what matters; the
// implementation can be swapped for a Web Worker (v1.5) or server cron
// + worker pool (v2) without touching agent code.
//
// Design note: a Web Worker is tempting but the agents need access to
// aiService (which holds the user's API keys in main-thread state) and
// IndexedDB writes work fine from the main thread. Keeping the tick in
// the main thread for v1 is simpler and correct.
// =====================================================================

export type TickHandler = (ctx: { now: number }) => Promise<void> | void;

export interface Scheduler {
  start(intervalMs: number, onTick: TickHandler): void;
  stop(): void;
  isRunning(): boolean;
  triggerNow(): Promise<void>;        // fire one tick immediately
}

export class IntervalScheduler implements Scheduler {
  private handle: number | null = null;
  private currentHandler: TickHandler | null = null;
  private running = false;
  private tickInFlight = false;

  start(intervalMs: number, onTick: TickHandler) {
    this.stop();
    this.currentHandler = onTick;
    this.running = true;
    // Fire one immediate tick so users see motion right away.
    this.tick();
    this.handle = (setInterval(() => this.tick(), intervalMs) as unknown) as number;
  }

  stop() {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
    this.running = false;
    this.currentHandler = null;
  }

  isRunning() {
    return this.running;
  }

  async triggerNow() {
    await this.tick();
  }

  private async tick() {
    if (!this.currentHandler) return;
    if (this.tickInFlight) return; // never overlap
    this.tickInFlight = true;
    try {
      await this.currentHandler({ now: Date.now() });
    } catch (err) {
      console.error('Scheduler tick error:', err);
    } finally {
      this.tickInFlight = false;
    }
  }
}

let _scheduler: Scheduler | null = null;
export function getScheduler(): Scheduler {
  if (!_scheduler) _scheduler = new IntervalScheduler();
  return _scheduler;
}
