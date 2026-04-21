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
  displayName: string;
  joinTime: number;
}

export interface CaptureOptions {
  onLateJoiner?: (userId: string, displayName: string) => void;
  resolveDisplayName?: (userId: string) => string;
}

export interface ParticipantInfo {
  userId: string;
  displayName: string;
  joinTime: number;
  meetingStartTime: number;
}

interface MeetingEntry {
  userMap: Map<string, UserCapture>;
  startTime: number;
}

const activeMeetings = new Map<string, MeetingEntry>();

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
    flushTime: Date.now(),
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
  const joinTime = Date.now();

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

    userMap.set(userId, { chunkIndex, chunkStartTime, writeStream, pcmPath, timer, displayName, joinTime });
  };

  startChunk(0);
}

export function startVoiceCapture(
  connection: VoiceConnection,
  meetingId: string,
  participants: Map<string, string>,
  options: CaptureOptions = {}
): void {
  if (!fs.existsSync(CHUNKS_DIR)) fs.mkdirSync(CHUNKS_DIR, { recursive: true });

  const userMap = new Map<string, UserCapture>();
  activeMeetings.set(meetingId, { userMap, startTime: Date.now() });

  for (const [userId, displayName] of participants) {
    startUserStream(connection, meetingId, userId, displayName, userMap);
  }

  connection.receiver.speaking.on('start', (userId) => {
    if (userMap.has(userId)) return;
    const displayName =
      participants.get(userId) ??
      options.resolveDisplayName?.(userId) ??
      userId;
    participants.set(userId, displayName);
    startUserStream(connection, meetingId, userId, displayName, userMap);
    options.onLateJoiner?.(userId, displayName);
  });
}

export async function stopUserCapture(meetingId: string, userId: string): Promise<void> {
  const entry = activeMeetings.get(meetingId);
  if (!entry) return;
  const capture = entry.userMap.get(userId);
  if (!capture) return;
  clearTimeout(capture.timer);
  entry.userMap.delete(userId);
  await flushUserChunk(meetingId, userId, capture.displayName, capture).catch((err) =>
    console.error(`[capture] Early leaver flush error for ${capture.displayName}: ${err.message}`)
  );
}

export async function stopVoiceCapture(meetingId: string): Promise<ParticipantInfo[]> {
  const entry = activeMeetings.get(meetingId);
  if (!entry) return [];

  const { userMap, startTime } = entry;
  const participants: ParticipantInfo[] = [];
  const flushPromises: Promise<void>[] = [];

  for (const [userId, capture] of userMap) {
    clearTimeout(capture.timer);
    participants.push({
      userId,
      displayName: capture.displayName,
      joinTime: capture.joinTime,
      meetingStartTime: startTime,
    });
    flushPromises.push(
      flushUserChunk(meetingId, userId, capture.displayName, capture).catch((err) =>
        console.error(`[capture] Final flush error for ${capture.displayName}: ${err.message}`)
      )
    );
  }

  await Promise.all(flushPromises);
  activeMeetings.delete(meetingId);
  return participants;
}

export function resetCapture(meetingId: string): void {
  const entry = activeMeetings.get(meetingId);
  if (!entry) return;
  for (const [, capture] of entry.userMap) {
    clearTimeout(capture.timer);
    try { capture.writeStream.destroy(); } catch { /* ignore */ }
    try { if (fs.existsSync(capture.pcmPath)) fs.unlinkSync(capture.pcmPath); } catch { /* ignore */ }
  }
  activeMeetings.delete(meetingId);
}
