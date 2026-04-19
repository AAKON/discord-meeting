import cron from 'node-cron';
import { joinVoiceChannel, VoiceConnectionStatus, entersState, VoiceConnection } from '@discordjs/voice';
import { TextChannel } from 'discord.js';
import { client } from '../bot/index';
import { config } from '../config';
import { Meeting } from '../db/models/meeting';
import { TranscriptEntry } from '../db/models/transcript';
import { startVoiceCapture, stopVoiceCapture } from '../voice/capture';

let scheduledMeetingId: string | null = null;
let scheduledConnection: VoiceConnection | null = null;

function timeToCron(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${m} ${h} * * *`;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function subtractMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m - minutes;
  const newH = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const newM = ((total % 60) + 60) % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

async function getTextChannel(): Promise<TextChannel> {
  const ch = await client.channels.fetch(config.MEETING_TEXT_CHANNEL_ID);
  if (!ch || !ch.isTextBased()) throw new Error('Text channel not found');
  return ch as TextChannel;
}

function buildParticipantMap(guildId: string): Map<string, string> {
  const guild = client.guilds.cache.get(guildId);
  const map = new Map<string, string>();
  if (!guild) return map;
  const vc = guild.channels.cache.get(config.MEETING_VOICE_CHANNEL_ID);
  if (!vc || !vc.isVoiceBased()) return map;
  vc.members.forEach((m) => map.set(m.id, m.displayName));
  return map;
}

export function startScheduler(): void {
  const meetingTime = config.MEETING_TIME;
  const duration = config.MEETING_DURATION_MINUTES;
  const reminderOffset = config.REMINDER_MINUTES_BEFORE;

  const reminderTime = subtractMinutes(meetingTime, reminderOffset);
  const endTime = addMinutes(meetingTime, duration);

  // Reminder
  cron.schedule(timeToCron(reminderTime), async () => {
    try {
      const textChannel = await getTextChannel();
      await textChannel.send(
        `📅 Daily standup starts in ${reminderOffset} minutes. Please join the voice channel.`
      );
    } catch (err) {
      console.error('[cron] Reminder error:', err);
    }
  });

  // Meeting start
  cron.schedule(timeToCron(meetingTime), async () => {
    try {
      const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID)
        ?? await client.guilds.fetch(config.DISCORD_GUILD_ID);
      if (!guild) throw new Error('Guild not found');

      const meeting = await Meeting.create({
        title: 'Daily Standup',
        scheduledTime: new Date(),
        startTime: new Date(),
        guildId: guild.id,
        voiceChannelId: config.MEETING_VOICE_CHANNEL_ID,
        textChannelId: config.MEETING_TEXT_CHANNEL_ID,
        status: 'active',
      });

      scheduledMeetingId = meeting._id.toString();

      scheduledConnection = joinVoiceChannel({
        channelId: config.MEETING_VOICE_CHANNEL_ID,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      await entersState(scheduledConnection, VoiceConnectionStatus.Ready, 10_000);

      const participants = buildParticipantMap(guild.id);
      startVoiceCapture(scheduledConnection, scheduledMeetingId, participants);

      const textChannel = await getTextChannel();
      await textChannel.send('🔴 Meeting started. Recording...');
    } catch (err) {
      console.error('[cron] Meeting start error:', err);
    }
  });

  // Meeting end
  cron.schedule(timeToCron(endTime), async () => {
    try {
      if (!scheduledMeetingId) return;

      const meetingId = scheduledMeetingId;
      scheduledMeetingId = null;

      await stopVoiceCapture(meetingId);

      if (scheduledConnection) {
        scheduledConnection.destroy();
        scheduledConnection = null;
      }

      await Meeting.findByIdAndUpdate(meetingId, { status: 'completed', endTime: new Date() });

      await new Promise((r) => setTimeout(r, 30_000));

      const entries = await TranscriptEntry.find({ meetingId }).sort({ startTimestamp: 1 });
      const transcript = entries.map((e) => `**${e.displayName}**: ${e.text}`).join('\n');

      const textChannel = await getTextChannel();
      if (transcript) {
        await textChannel.send(`📝 **Meeting Transcript**\n\n${transcript}`);
      }
      await textChannel.send('✅ Meeting ended. Transcript posted above.');
    } catch (err) {
      console.error('[cron] Meeting end error:', err);
    }
  });

  console.log(
    `[cron] Scheduled — reminder: ${reminderTime}, start: ${meetingTime}, end: ${endTime}`
  );
}
