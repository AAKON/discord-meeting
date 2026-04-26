import { transcriptionQueue } from '../queue';
import { startTranscriptionWorker } from '../transcription/worker';
import { connectDB } from '../db/mongoose';
import mongoose from 'mongoose';

(async () => {
  await connectDB();

  startTranscriptionWorker();

  await transcriptionQueue.add('transcribe', {
    meetingId: '000000000000000000000001',
    userId: 'test-user-123',
    displayName: 'Test User',
    audioFilePath: '/nonexistent/sample.wav',
    chunkIndex: 0,
    timestamp: Date.now(),
    flushTime: Date.now(),
  });

  console.log(`Job added to in-process queue`);

  await new Promise((r) => setTimeout(r, 5000));

  await transcriptionQueue.close();
  await mongoose.connection.close();
  process.exit(0);
})().catch((err) => {
  console.error('Queue test failed:', err);
  process.exit(1);
});
