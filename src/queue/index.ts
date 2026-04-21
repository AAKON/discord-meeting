import { Queue } from 'bullmq';
import { config } from '../config';

export interface TranscriptionJobData {
  meetingId: string;
  userId: string;
  displayName: string;
  audioFilePath: string;
  chunkIndex: number;
  timestamp: number;
  flushTime: number;
}

const connection = {
  url: config.REDIS_URL,
};

export const transcriptionQueue = new Queue<TranscriptionJobData>('transcription-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});
