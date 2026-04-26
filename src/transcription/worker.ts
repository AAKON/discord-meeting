import fs from 'fs';
import mongoose from 'mongoose';
import { transcribeAudio } from './index';
import { TranscriptEntry } from '../db/models/transcript';
import { transcriptionQueue, type TranscriptionJobData } from '../queue';

/**
 * Registers the transcription processor with the in-process queue.
 * No BullMQ / Redis involved — jobs run directly in this process.
 */
export function startTranscriptionWorker(): void {
  transcriptionQueue.setProcessor(async (data: TranscriptionJobData) => {
    const { meetingId, userId, displayName, audioFilePath, chunkIndex, timestamp, flushTime } = data;

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
      endTimestamp:   new Date(flushTime),
      text,
      chunkIndex,
    });

    fs.unlinkSync(audioFilePath);
    console.log(`[transcript] ${displayName} (chunk ${chunkIndex}): ${text}`);
  });

  console.log('[worker] In-process transcription worker ready (no Redis)');
}
