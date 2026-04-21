import { transcriptionQueue } from '../queue';
import { startTranscriptionWorker } from '../transcription/worker';
import { connectDB } from '../db/mongoose';

(async () => {
  await connectDB();

  const worker = startTranscriptionWorker();

  const job = await transcriptionQueue.add('transcribe', {
    meetingId: '000000000000000000000001',
    userId: 'test-user-123',
    displayName: 'Test User',
    audioFilePath: '/nonexistent/sample.wav',
    chunkIndex: 0,
    timestamp: Date.now(),
    flushTime: Date.now(),
  });

  console.log(`Job added: ${job.id}`);

  await new Promise((r) => setTimeout(r, 5000));

  const state = await job.getState();
  console.log(`Job state: ${state}`);

  await worker.close();
  await transcriptionQueue.close();
  process.exit(0);
})().catch((err) => {
  console.error('Queue test failed:', err);
  process.exit(1);
});
