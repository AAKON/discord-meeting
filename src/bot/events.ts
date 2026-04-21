import {
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
  VoiceState,
} from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, entersState, VoiceConnection } from '@discordjs/voice';
import { client } from './index';
import { config } from '../config';
import { Meeting } from '../db/models/meeting';
import { TranscriptEntry } from '../db/models/transcript';
import { Task } from '../db/models/task';
import { startVoiceCapture, stopVoiceCapture, stopUserCapture } from '../voice/capture';
import { summarizeMeeting } from '../transcription/summarize';
import { extractTasksFromMeeting, getTasksByAssignee } from '../transcription/tasks';
import { sendLongMessage } from './utils';
import { transcriptionQueue } from '../queue';
import { waitForQueueDrain } from '../utils/queue';
import mongoose from 'mongoose';

let activeMeetingId: string | null = null;
let activeConnection: VoiceConnection | null = null;
let earlyLeaverListener: ((o: VoiceState, n: VoiceState) => void) | null = null;

export function getActiveMeetingId(): string | null { return activeMeetingId; }
export function getActiveConnection(): VoiceConnection | null { return activeConnection; }
export function setActiveConnection(c: VoiceConnection | null): void { activeConnection = c; }

async function getTextChannel(): Promise<TextChannel> {
  const ch = await client.channels.fetch(config.MEETING_TEXT_CHANNEL_ID);
  if (!ch || !ch.isTextBased()) throw new Error('Text channel not found');
  return ch as TextChannel;
}

function buildParticipantMap(guildId: string): Map<string, string> {
  const guild = client.guilds.cache.get(guildId);
  const map = new Map<string, string>();
  if (!guild) return map;
  const voiceChannel = guild.channels.cache.get(config.MEETING_VOICE_CHANNEL_ID);
  if (!voiceChannel || !voiceChannel.isVoiceBased()) return map;
  voiceChannel.members.forEach((member: GuildMember) => {
    map.set(member.id, member.displayName);
  });
  return map;
}

async function handleStartMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const meeting = await Meeting.create({
    title: 'Manual Meeting',
    scheduledTime: new Date(),
    startTime: new Date(),
    guildId: interaction.guildId!,
    voiceChannelId: config.MEETING_VOICE_CHANNEL_ID,
    textChannelId: config.MEETING_TEXT_CHANNEL_ID,
    status: 'active',
  });

  activeMeetingId = meeting._id.toString();

  const guild = interaction.guild!;
  const connection = joinVoiceChannel({
    channelId: config.MEETING_VOICE_CHANNEL_ID,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  activeConnection = connection;

  const textChannel = await getTextChannel();
  const meetingIdForCapture = activeMeetingId;

  earlyLeaverListener = (oldState: VoiceState, newState: VoiceState) => {
    if (!activeMeetingId) return;
    if (oldState.channelId !== config.MEETING_VOICE_CHANNEL_ID) return;
    if (newState.channelId === config.MEETING_VOICE_CHANNEL_ID) return;
    if (newState.id === client.user?.id) return;
    const displayName = oldState.member?.displayName ?? newState.id;
    stopUserCapture(meetingIdForCapture!, newState.id).catch(console.error);
    textChannel.send(`⚠️ **${displayName}** left the meeting early.`).catch(console.error);
  };
  client.on('voiceStateUpdate', earlyLeaverListener);

  const participants = buildParticipantMap(guild.id);
  startVoiceCapture(connection, activeMeetingId, participants, {
    resolveDisplayName: (userId) =>
      guild.members.cache.get(userId)?.displayName ?? userId,
    onLateJoiner: (_, displayName) => {
      textChannel.send(`🕐 **${displayName}** joined late.`).catch(console.error);
    },
  });

  await textChannel.send('🔴 Meeting started. Recording...');
  await interaction.editReply('Meeting started.');
}

async function handleEndMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  if (!activeMeetingId) {
    await interaction.editReply('No active meeting.');
    return;
  }

  const meetingId = activeMeetingId;
  activeMeetingId = null;

  if (earlyLeaverListener) {
    client.off('voiceStateUpdate', earlyLeaverListener);
    earlyLeaverListener = null;
  }

  await stopVoiceCapture(meetingId);

  activeConnection?.destroy();
  activeConnection = null;

  const endTime = new Date();
  await Meeting.findByIdAndUpdate(meetingId, { status: 'completed', endTime });

  await waitForQueueDrain(transcriptionQueue);

  const entries = await TranscriptEntry.find({ meetingId }).sort({ startTimestamp: 1 });

  const textChannel = await getTextChannel();
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
  } else {
    await textChannel.send('No speech recorded.');
  }
  await textChannel.send('✅ Meeting ended.');
  await interaction.editReply('Meeting ended.');
}

async function handleMeetingSummary(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const meeting = await Meeting.findOne({ status: 'completed' }).sort({ endTime: -1 });
  if (!meeting) {
    await interaction.editReply('No completed meetings found.');
    return;
  }

  const entries = await TranscriptEntry.find({ meetingId: meeting._id }).sort({ startTimestamp: 1 });
  if (!entries.length) {
    await interaction.editReply('No transcript for the latest meeting.');
    return;
  }

  const transcript = entries.map((e) => `**${e.displayName}**: ${e.text}`).join('\n');
  const textChannel = await getTextChannel();
  await sendLongMessage(textChannel, transcript, `📝 **Summary — ${meeting.title}**\n`);
  await interaction.editReply('Summary posted.');
}

async function handleAttendance(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const meeting = await Meeting.findOne({ status: 'completed' }).sort({ endTime: -1 });
  if (!meeting) {
    await interaction.editReply('No completed meetings found.');
    return;
  }

  const speakers = await TranscriptEntry.distinct('displayName', { meetingId: meeting._id });
  if (!speakers.length) {
    await interaction.editReply('No attendance data.');
    return;
  }

  await interaction.editReply(
    `👥 **Attendance — ${meeting.title}**\n${speakers.map((s: string) => `• ${s}`).join('\n')}`
  );
}

async function handleAssignTask(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const assignedTo = interaction.options.getString('assigned-to', true);
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description', false);

  if (!activeMeetingId) {
    await interaction.editReply('No active meeting. Start a meeting first.');
    return;
  }

  const task = await Task.create({
    meetingId: new mongoose.Types.ObjectId(activeMeetingId),
    assignedTo,
    title,
    description: description || undefined,
    status: 'assigned',
  });

  const textChannel = await getTextChannel();
  await textChannel.send(`📌 **Task Assigned**\n👤 **${assignedTo}**: ${title}${description ? `\n${description}` : ''}`);

  await interaction.editReply('Task assigned successfully.');
}

async function handleShowTasks(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const meeting = await Meeting.findOne({ status: 'completed' }).sort({ endTime: -1 });
  if (!meeting) {
    await interaction.editReply('No completed meetings found.');
    return;
  }

  const tasksByAssignee = await getTasksByAssignee(meeting._id.toString());

  if (tasksByAssignee.size === 0) {
    await interaction.editReply('No tasks found for the latest meeting.');
    return;
  }

  let tasksMessage = '📋 **Tasks — Latest Meeting**\n\n';
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

  await interaction.editReply(tasksMessage);
}

async function handleCreateMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const title = interaction.options.getString('title', true);
  const timeStr = interaction.options.getString('time', true);
  const scheduledTime = new Date(timeStr);

  if (isNaN(scheduledTime.getTime())) {
    await interaction.editReply('Invalid time format. Use ISO 8601 or HH:MM.');
    return;
  }

  const meeting = await Meeting.create({
    title,
    scheduledTime,
    guildId: interaction.guildId!,
    voiceChannelId: config.MEETING_VOICE_CHANNEL_ID,
    textChannelId: config.MEETING_TEXT_CHANNEL_ID,
    status: 'scheduled',
  });

  await interaction.editReply(`Meeting "${title}" created (ID: ${meeting._id}).`);
}

export function registerEvents(): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case 'create-meeting': await handleCreateMeeting(interaction); break;
        case 'start-meeting':  await handleStartMeeting(interaction);  break;
        case 'end-meeting':    await handleEndMeeting(interaction);    break;
        case 'meeting-summary': await handleMeetingSummary(interaction); break;
        case 'attendance':     await handleAttendance(interaction);    break;
        case 'assign-task':    await handleAssignTask(interaction);    break;
        case 'show-tasks':     await handleShowTasks(interaction);     break;
      }
    } catch (err) {
      console.error(`[events] Command error:`, err);
      const msg = 'An error occurred.';
      if (interaction.deferred) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, ephemeral: true });
    }
  });
}

export { activeMeetingId };
