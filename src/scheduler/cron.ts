import cron from 'node-cron';
import { joinVoiceChannel, VoiceConnectionStatus, entersState, VoiceConnection } from '@discordjs/voice';
import { TextChannel, VoiceState } from 'discord.js';
import { client } from '../bot/index';
import { config } from '../config';
import { Meeting } from '../db/models/meeting';
import { TranscriptEntry } from '../db/models/transcript';
import { startVoiceCapture, stopVoiceCapture, stopUserCapture } from '../voice/capture';
import { summarizeMeeting } from '../transcription/summarize';
import { extractTasksFromMeeting, getTasksByAssignee } from '../transcription/tasks';
import { sendLongMessage } from '../bot/utils';
import { transcriptionQueue } from '../queue';
import { waitForQueueDrain } from '../utils/queue';

let scheduledMeetingId: string | null = null;
let scheduledConnection: VoiceConnection | null = null;
let earlyLeaverListener: ((o: VoiceState, n: VoiceState) => void) | null = null;

function getUTCHourOffset(): number {
  const timezones: Record<string, number> = {
    'Asia/Dhaka': 6,
    'Asia/Kolkata': 5.5,
    'UTC': 0,
    'America/New_York': -5,
    'Europe/London': 0,
  };
  const tz = config.TIMEZONE;
  return timezones[tz] ?? 0;
}

function convertToUTCTime(hhmm: string, tzOffset: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const totalMinutes = h * 60 + m - Math.round(tzOffset * 60);
  const newH = ((totalMinutes / 60) % 24 + 24) % 24;
  const newM = totalMinutes % 60;
  return `${String(Math.floor(newH)).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

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
  const tzOffset = getUTCHourOffset();

  const reminderTime = subtractMinutes(meetingTime, reminderOffset);
  const endTime = addMinutes(meetingTime, duration);

  // Convert to UTC for cron scheduling
  const utcMeetingTime = convertToUTCTime(meetingTime, tzOffset);
  const utcReminderTime = convertToUTCTime(reminderTime, tzOffset);
  const utcEndTime = convertToUTCTime(endTime, tzOffset);

  // Reminder
  cron.schedule(timeToCron(utcReminderTime), async () => {
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
  cron.schedule(timeToCron(utcMeetingTime), async () => {
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

      const textChannel = await getTextChannel();
      const capturedMeetingId = scheduledMeetingId;

      earlyLeaverListener = (oldState: VoiceState, newState: VoiceState) => {
        if (!scheduledMeetingId) return;
        if (oldState.channelId !== config.MEETING_VOICE_CHANNEL_ID) return;
        if (newState.channelId === config.MEETING_VOICE_CHANNEL_ID) return;
        if (newState.id === client.user?.id) return;
        const displayName = oldState.member?.displayName ?? newState.id;
        stopUserCapture(capturedMeetingId!, newState.id).catch(console.error);
        textChannel.send(`⚠️ **${displayName}** left the meeting early.`).catch(console.error);
      };
      client.on('voiceStateUpdate', earlyLeaverListener);

      const participants = buildParticipantMap(guild.id);
      startVoiceCapture(scheduledConnection, scheduledMeetingId, participants, {
        resolveDisplayName: (userId) =>
          guild.members.cache.get(userId)?.displayName ?? userId,
        onLateJoiner: (_, displayName) => {
          textChannel.send(`🕐 **${displayName}** joined late.`).catch(console.error);
        },
      });

      await textChannel.send('🔴 Meeting started. Recording...');
    } catch (err) {
      console.error('[cron] Meeting start error:', err);
    }
  });

  // Meeting end
  cron.schedule(timeToCron(utcEndTime), async () => {
    try {
      if (!scheduledMeetingId) return;

      const meetingId = scheduledMeetingId;
      scheduledMeetingId = null;

      if (earlyLeaverListener) {
        client.off('voiceStateUpdate', earlyLeaverListener);
        earlyLeaverListener = null;
      }

      await stopVoiceCapture(meetingId);

      if (scheduledConnection) {
        scheduledConnection.destroy();
        scheduledConnection = null;
      }

      await Meeting.findByIdAndUpdate(meetingId, { status: 'completed', endTime: new Date() });

      await waitForQueueDrain(transcriptionQueue);

      const meeting = await Meeting.findById(meetingId);
      const entries = await TranscriptEntry.find({ meetingId }).sort({ startTimestamp: 1 });

      const textChannel = await getTextChannel();

      // Display meeting duration
      if (meeting && meeting.startTime && meeting.endTime) {
        const durationMs = meeting.endTime.getTime() - meeting.startTime.getTime();
        const durationMins = Math.floor(durationMs / 60_000);
        const durationSecs = Math.floor((durationMs % 60_000) / 1_000);
        const durationStr = `${durationMins}m ${durationSecs}s`;

        // Display participant info
        let participantInfo = '';
        if (meeting.participants && meeting.participants.length > 0) {
          const lateJoiners = meeting.participants.filter((p) => p.isLateJoiner).map((p) => p.displayName);
          const earlyLeavers = meeting.participants.filter((p) => p.isEarlyLeaver).map((p) => p.displayName);

          if (lateJoiners.length > 0 || earlyLeavers.length > 0) {
            participantInfo += '\n';
            if (lateJoiners.length > 0) {
              participantInfo += `⏰ **Late Joiners**: ${lateJoiners.join(', ')}\n`;
            }
            if (earlyLeavers.length > 0) {
              participantInfo += `🚪 **Early Leavers**: ${earlyLeavers.join(', ')}`;
            }
          }
        }

        await textChannel.send(
          `⏱️ **Meeting Duration**: ${durationStr}${participantInfo}`
        );
      }

      if (entries.length) {
        const transcript = entries.map((e) => `**${e.displayName}**: ${e.text}`).join('\n');
        await sendLongMessage(textChannel, transcript, '📝 **Conversation**\n');

        // Extract and display tasks
        await extractTasksFromMeeting(meetingId, entries);
        const tasksByAssignee = await getTasksByAssignee(meetingId);

        if (tasksByAssignee.size > 0) {
          let tasksMessage = '📋 **Task Assignments**\n\n';
          for (const [assignee, tasks] of tasksByAssignee) {
            tasksMessage += `👤 **${assignee}**\n`;
            for (const task of tasks) {
              tasksMessage += `  • ${task.title}`;
              if (task.description) {
                tasksMessage += ` - ${task.description}`;
              }
              tasksMessage += '\n';
            }
            tasksMessage += '\n';
          }
          await textChannel.send(tasksMessage);
        }

        const summary = await summarizeMeeting(entries);
        await sendLongMessage(textChannel, summary, '📋 **Summary**\n');
      }
      await textChannel.send('✅ Meeting ended.');
    } catch (err) {
      console.error('[cron] Meeting end error:', err);
    }
  });

  console.log(
    `[cron] Scheduled (${config.TIMEZONE}) — reminder: ${reminderTime}, start: ${meetingTime}, end: ${endTime}`
  );
}
