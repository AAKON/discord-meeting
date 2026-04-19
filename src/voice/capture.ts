import fs from 'fs';
import path from 'path';
import { VoiceConnection, EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { convertPcmToWav } from './converter';
import { transcriptionQueue } from '../queue';

const CHUNK_INTERVAL_MS = 15_000;
const CHUNKS_DIR = path.resolve('chunks');

interface UserCapture {
  chunkIndex: number;
  chunkStartTime: number;
  writeStream: fs.WriteStream;
  pcmPath: string;
  timer: NodeJS.Timeout;
}

const activeMeetings = new Map<string, Map<string, UserCapture>>();

async function flushUserChunk(
  meetingId: string,
  userId: string,
  displayName: string,
  capture: UserCapture
): Promise<void> {
  const { pcmPath, chunkIndex, chunkStartTime } = capture;

  await new Promise<void>((resolve) => capture.writeStream.end(resolve));

  if (!fs.existsSync(pcmPath) || fs.statSync(pcmPath).size === 0) {
    if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    return;
  }

  const wavPath = pcmPath.replace('.pcm', '.wav');
  await convertPcmToWav(pcmPath, wavPath);
  fs.unlinkSync(pcmPath);

  await transcriptionQueue.add('transcribe', {
    meetingId,
    userId,
    displayName,
    audioFilePath: wavPath,
    chunkIndex,
    timestamp: chunkStartTime,
  });
}

function startUserStream(
  connection: VoiceConnection,
  meetingId: string,
  userId: string,
  displayName: string,
  userMap: Map<string, UserCapture>
): void {
  const receiver = connection.receiver;

  const startChunk = (chunkIndex: number): void => {
    const chunkStartTime = Date.now();
    const pcmPath = path.join(CHUNKS_DIR, `${meetingId}_${userId}_${chunkIndex}.pcm`);
    const writeStream = fs.createWriteStream(pcmPath);

    const subscription = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: CHUNK_INTERVAL_MS },
    });

    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    subscription.pipe(decoder).pipe(writeStream);

    const timer = setTimeout(async () => {
      subscription.destroy();
      const capture = userMap.get(userId);
      if (!capture) return;

      await flushUserChunk(meetingId, userId, displayName, capture).catch((err) =>
        console.error(`[capture] Flush error for ${displayName}: ${err.message}`)
      );

      if (userMap.has(userId)) {
        startChunk(chunkIndex + 1);
      }
    }, CHUNK_INTERVAL_MS);

    userMap.set(userId, { chunkIndex, chunkStartTime, writeStream, pcmPath, timer });
  };

  startChunk(0);
}

export function startVoiceCapture(
  connection: VoiceConnection,
  meetingId: string,
  participants: Map<string, string>
): void {
  if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });

  const userMap = new Map<string, UserCapture>();
  activeMeetings.set(meetingId, userMap);

  for (const [userId, displayName] of participants) {
    startUserStream(connection, meetingId, userId, displayName, userMap);
  }

  connection.receiver.speaking.on('start', (userId) => {
    if (userMap.has(userId)) return;
    const displayName = participants.get(userId) ?? userId;
    startUserStream(connection, meetingId, userId, displayName, userMap);
  });
}

export async function stopVoiceCapture(meetingId: string): Promise<void> {
  const userMap = activeMeetings.get(meetingId);
  if (!userMap) return;

  const flushPromises: Promise<void>[] = [];

  for (const [userId, capture] of userMap) {
    clearTimeout(capture.timer);
    const displayName = userId;
    flushPromises.push(
      flushUserChunk(meetingId, userId, displayName, capture).catch((err) =>
        console.error(`[capture] Final flush error for ${userId}: ${err.message}`)
      )
    );
  }

  await Promise.all(flushPromises);
  activeMeetings.delete(meetingId);
}
