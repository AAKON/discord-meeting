import { Queue } from 'bullmq';

export async function waitForQueueDrain(queue: Queue, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
    if (counts.active + counts.waiting + counts.delayed === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn('[queue] Drain timeout reached — some jobs may still be running');
}
