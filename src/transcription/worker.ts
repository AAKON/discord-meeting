import { Worker } from 'bullmq';
import fs from 'fs';
import mongoose from 'mongoose';
import { config } from '../config';
import { transcribeAudio } from './deepgram';
import { TranscriptEntry } from '../db/models/transcript';
import type { TranscriptionJobData } from '../queue';

const connection = { url: config.REDIS_URL };

export function startTranscriptionWorker(): Worker<TranscriptionJobData> {
  const worker = new Worker<TranscriptionJobData>(
    'transcription-queue',
    async (job) => {
      const { meetingId, userId, displayName, audioFilePath, chunkIndex, timestamp, flushTime } = job.data;

      if (!fs.existsSync(audioFilePath)) {
        console.warn(`[worker] Audio file not found, skipping: ${audioFilePath}`);
        return;
      }

      const text = await transcribeAudio(audioFilePath);

      if (!text.trim()) {
        fs.unlinkSync(audioFilePath);
        return;
      }

      await TranscriptEntry.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        discordUserId: userId,
        displayName,
        startTimestamp: new Date(timestamp),
        endTimestamp: new Date(flushTime),
        text,
        chunkIndex,
      });

      fs.unlinkSync(audioFilePath);
      console.log(`[transcript] ${displayName} (chunk ${chunkIndex}): ${text}`);
    },
    { connection, concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed: ${err.message}`);
    const filePath = job?.data.audioFilePath;
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  });

  return worker;
}
