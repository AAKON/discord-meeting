import { transcriptionQueue } from '../queue';

/**
 * Waits for all active and pending transcription jobs to finish.
 * Delegates to the in-process queue's built-in drain() method.
 */
export async function waitForQueueDrain(
  _queue: typeof transcriptionQueue,
  timeoutMs = 60_000,
): Promise<void> {
  await transcriptionQueue.drain(timeoutMs);
}
