import { Worker } from 'bullmq';
import fs from 'fs';
import mongoose from 'mongoose';
import { config } from '../config';
import { transcribeAudio } from './groq';
import { TranscriptEntry } from '../db/models/transcript';
import type { TranscriptionJobData } from '../queue';

const connection = { url: config.REDIS_URL };

export function startTranscriptionWorker(): Worker<TranscriptionJobData> {
  const worker = new Worker<TranscriptionJobData>(
    'transcription-queue',
    async (job) => {
      const { meetingId, userId, displayName, audioFilePath, chunkIndex, timestamp } = job.data;

      if (!fs.existsSync(audioFilePath)) {
        console.warn(`[worker] Audio file not found, skipping: ${audioFilePath}`);
        return;
      }

      const text = await transcribeAudio(audioFilePath);

      if (!text.trim()) {
        fs.unlinkSync(audioFilePath);
        return;
      }

      const startTimestamp = new Date(timestamp);
      const endTimestamp = new Date(timestamp + 15_000);

      await TranscriptEntry.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        discordUserId: userId,
        displayName,
        startTimestamp,
        endTimestamp,
        text,
        chunkIndex,
      });

      fs.unlinkSync(audioFilePath);
      console.log(`[transcript] ${displayName} (chunk ${chunkIndex}): ${text}`);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
