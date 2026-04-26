/**
 * In-process transcription queue — replaces BullMQ + Redis entirely.
 *
 * Why: BullMQ uses ~15-20 Redis commands per job plus constant polling.
 * This bot is a single process, so a distributed queue adds no value
 * and quickly exhausts free-tier Redis request limits (e.g. Upstash 500k/day).
 *
 * This implementation provides:
 *  - Concurrency control (max 5 jobs at once)
 *  - Automatic retry with exponential back-off (3 attempts)
 *  - drain() — waits for all active/pending jobs to finish
 *  - close() — stops accepting new jobs then drains
 *  - Same add() / close() call signatures as the old BullMQ Queue
 */

export interface TranscriptionJobData {
  meetingId: string;
  userId: string;
  displayName: string;
  audioFilePath: string;
  chunkIndex: number;
  timestamp: number;
  flushTime: number;
}

type Processor = (data: TranscriptionJobData) => Promise<void>;

const CONCURRENCY   = 5;
const MAX_ATTEMPTS  = 3;
const BASE_DELAY_MS = 2_000; // doubles each retry: 2s, 4s, 8s

class InProcessQueue {
  private pending: TranscriptionJobData[] = [];
  private active   = 0;
  private closed   = false;
  private processor: Processor | null = null;

  // ── Called once by startTranscriptionWorker() ─────────────────────────────
  setProcessor(fn: Processor): void {
    this.processor = fn;
    this.tick();
  }

  // ── Same signature as bullmq Queue.add() ──────────────────────────────────
  async add(_name: string, data: TranscriptionJobData): Promise<void> {
    if (this.closed) return;
    this.pending.push(data);
    this.tick();
  }

  // ── Drain: waits until active + pending reaches zero ─────────────────────
  async drain(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this.active > 0 || this.pending.length > 0) && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    if (this.active > 0 || this.pending.length > 0) {
      console.warn('[queue] Drain timeout — some transcription jobs may still be running');
    }
  }

  // ── Close: stop accepting jobs, then drain ────────────────────────────────
  async close(): Promise<void> {
    this.closed = true;
    await this.drain(30_000);
  }

  // ── Expose counts so waitForQueueDrain() can stay a no-op wrapper ─────────
  getJobCounts(): { active: number; waiting: number; delayed: number } {
    return { active: this.active, waiting: this.pending.length, delayed: 0 };
  }

  // ── Internal: pull jobs off the queue up to the concurrency limit ─────────
  private tick(): void {
    if (!this.processor) return;
    while (this.active < CONCURRENCY && this.pending.length > 0) {
      const data = this.pending.shift()!;
      this.active++;
      this.runWithRetry(data).finally(() => {
        this.active--;
        this.tick();
      });
    }
  }

  private async runWithRetry(data: TranscriptionJobData, attempt = 1): Promise<void> {
    try {
      await this.processor!(data);
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[queue] Job failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms:`, (err as Error).message);
        await new Promise<void>((r) => setTimeout(r, delay));
        return this.runWithRetry(data, attempt + 1);
      }
      console.error(`[queue] Job failed after ${MAX_ATTEMPTS} attempts, giving up:`, (err as Error).message);
    }
  }
}

export const transcriptionQueue = new InProcessQueue();
