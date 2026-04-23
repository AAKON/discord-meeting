import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { VoiceConnection } from '@discordjs/voice';
import { client } from './index';
import { Meeting } from '../db/models/meeting';
import { TranscriptEntry } from '../db/models/transcript';
import { Task } from '../db/models/task';
import { GuildConfig } from '../db/models/guildConfig';
import { GuildNotConfiguredError, requireGuildConfig } from './guards';
import { restartGuildScheduler, scheduleOneOffMeeting } from '../scheduler/cron';
import { meetingState } from './meetingState';
import { runMeetingStart, runMeetingEnd } from './meetingRunner';
import {
  handleAdminDmMessage,
  handleDispatchButton,
  handleEditSummaryButton,
  handleEditTaskButton,
  handleSkipTaskButton,
  handleTaskAssignSelect,
  handleTaskModalSubmit,
} from './approval';
import { getTextChannel } from '../utils/discord';
import { sendLongMessage } from './utils';
import { getTasksByAssignee } from '../transcription/tasks';
import mongoose from 'mongoose';

// ── Shims for index.ts reconnect logic — fully replaced in Step 11 ──────────
export function getActiveMeetingId(): string | null { return null; }
export function getActiveConnection(): VoiceConnection | null { return null; }
export function setActiveConnection(_c: VoiceConnection | null): void { /* Step 11 */ }

// ── /setup ───────────────────────────────────────────────────────────────────

async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  console.log(`[setup] Interaction from ${interaction.user.tag} in guild ${interaction.guildId}`);
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.editReply('Only server admins can run `/setup`.');
    return;
  }

  const voiceChannel = interaction.options.getChannel('voice-channel', true);
  const textChannel  = interaction.options.getChannel('text-channel', true);
  const meetingTime  = interaction.options.getString('meeting-time', true);
  const timezone     = interaction.options.getString('timezone', true);
  const duration     = interaction.options.getInteger('duration') ?? 30;
  const reminder     = interaction.options.getInteger('reminder') ?? 5;

  if (!/^\d{2}:\d{2}$/.test(meetingTime)) {
    await interaction.editReply('Invalid time format. Use HH:MM (e.g. `10:00`).');
    return;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    await interaction.editReply(
      `Invalid timezone: \`${timezone}\`. Use an IANA timezone (e.g. \`Asia/Dhaka\`, \`UTC\`, \`America/New_York\`).`
    );
    return;
  }

  const guild     = interaction.guild!;
  const botMember = guild.members.me;
  if (!botMember) {
    await interaction.editReply('Could not verify bot permissions.');
    return;
  }

  // Fetch channels explicitly — cache may be empty in freshly-joined servers
  let vc, tc;
  try {
    vc = await guild.channels.fetch(voiceChannel.id);
    tc = await guild.channels.fetch(textChannel.id);
  } catch {
    await interaction.editReply('Could not resolve the selected channels. Make sure the bot has **View Channel** permission.');
    return;
  }

  if (!vc || !botMember.permissionsIn(vc).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    await interaction.editReply(`Bot is missing **Connect** or **Speak** in <#${voiceChannel.id}>.`);
    return;
  }
  if (!tc || !botMember.permissionsIn(tc).has(PermissionFlagsBits.SendMessages)) {
    await interaction.editReply(`Bot is missing **Send Messages** in <#${textChannel.id}>.`);
    return;
  }

  const guildConfig = await GuildConfig.findOneAndUpdate(
    { guildId: interaction.guildId! },
    {
      guildId: interaction.guildId!,
      voiceChannelId: voiceChannel.id,
      textChannelId: textChannel.id,
      timezone,
      adminUserId: interaction.user.id,
      meetingTime,
      meetingDurationMinutes: duration,
      reminderMinutesBefore: reminder,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  restartGuildScheduler(guildConfig);

  console.log(`[setup] Guild ${interaction.guildId} configured by ${interaction.user.tag}`);
  await interaction.editReply(
    `**StandupBot configured!**\n` +
    `• Voice: <#${voiceChannel.id}>\n` +
    `• Text: <#${textChannel.id}>\n` +
    `• Daily standup: **${meetingTime}** (${timezone})\n` +
    `• Duration: **${duration} min** | Reminder: **${reminder} min** before`
  );
}

// ── /config show ─────────────────────────────────────────────────────────────

async function handleConfigShow(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const cfg = await GuildConfig.findOne({ guildId: interaction.guildId!, isActive: true });
  if (!cfg) {
    await interaction.editReply('Not configured yet. Run `/setup` to get started.');
    return;
  }

  await interaction.editReply(
    `**StandupBot Config**\n` +
    `• Voice: <#${cfg.voiceChannelId}>\n` +
    `• Text: <#${cfg.textChannelId}>\n` +
    `• Standup: **${cfg.meetingTime}** (${cfg.timezone})\n` +
    `• Duration: **${cfg.meetingDurationMinutes} min** | Reminder: **${cfg.reminderMinutesBefore} min** before\n` +
    `• Admin: <@${cfg.adminUserId}>`
  );
}

// ── /start-meeting ────────────────────────────────────────────────────────────

async function handleStartMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  if (meetingState.has(cfg.guildId)) {
    await interaction.editReply('A meeting is already active.');
    return;
  }

  await runMeetingStart(cfg, { title: 'Standup', type: 'immediate' });
  await interaction.editReply('Meeting started.');
}

// ── /schedule-meeting ─────────────────────────────────────────────────────────

async function handleScheduleMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  const title          = interaction.options.getString('title', true);
  const date           = interaction.options.getString('date', true);
  const time           = interaction.options.getString('time', true);
  const participantRaw = interaction.options.getString('participants');

  const scheduledTime = new Date(`${date}T${time}:00`);
  if (isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
    await interaction.editReply('Invalid date/time, or the time is in the past.');
    return;
  }

  const participantIds: string[] = [];
  if (participantRaw) {
    const re = /<@!?(\d+)>/g;
    let m;
    while ((m = re.exec(participantRaw)) !== null) participantIds.push(m[1]);
  }

  const guild        = interaction.guild!;
  const participants = participantIds.map((id) => ({
    userId: id,
    displayName: guild.members.cache.get(id)?.displayName ?? id,
    joinTime: scheduledTime,
    isLateJoiner: false,
    isEarlyLeaver: false,
    isAbsent: false,
  }));

  const meeting = await Meeting.create({
    title,
    type: 'oneoff',
    scheduledTime,
    guildId: cfg.guildId,
    voiceChannelId: cfg.voiceChannelId,
    textChannelId: cfg.textChannelId,
    status: 'scheduled',
    participants,
  });

  scheduleOneOffMeeting(meeting, cfg);

  const formatted = scheduledTime.toLocaleString('en-US', {
    timeZone: cfg.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  await interaction.editReply(
    `📅 **Meeting scheduled!**\n` +
    `• Title: **${title}**\n` +
    `• Time: **${formatted}** (${cfg.timezone})\n` +
    `• ID: \`${meeting._id}\`` +
    (participants.length ? `\n• Participants: ${participantIds.map((id) => `<@${id}>`).join(' ')}` : '')
  );
}

// ── /end-meeting ──────────────────────────────────────────────────────────────

async function handleEndMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  if (!meetingState.has(cfg.guildId)) {
    await interaction.editReply('No active meeting.');
    return;
  }

  await runMeetingEnd(cfg);
  await interaction.editReply('Meeting ended.');
}

// ── /assign-task ──────────────────────────────────────────────────────────────

async function handleAssignTask(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg    = await requireGuildConfig(interaction.guildId!);
  const active = meetingState.get(cfg.guildId);

  if (!active) {
    await interaction.editReply('No active meeting. Start a meeting first.');
    return;
  }

  const assignedTo  = interaction.options.getString('assigned-to', true);
  const title       = interaction.options.getString('title', true);
  const description = interaction.options.getString('description');

  await Task.create({
    meetingId: new mongoose.Types.ObjectId(active.meetingId),
    assignedTo,
    title,
    description: description ?? undefined,
    status: 'assigned',
  });

  const textChannel = await getTextChannel(cfg.textChannelId);
  await textChannel.send(
    `📌 **Task Assigned**\n👤 **${assignedTo}**: ${title}${description ? `\n${description}` : ''}`
  );
  await interaction.editReply('Task assigned.');
}

// ── /show-tasks ───────────────────────────────────────────────────────────────

async function handleShowTasks(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  const meeting = await Meeting.findOne({ guildId: cfg.guildId, status: 'completed' }).sort({ endTime: -1 });
  if (!meeting) {
    await interaction.editReply('No completed meetings found.');
    return;
  }

  const tasksByAssignee = await getTasksByAssignee(meeting._id.toString());
  if (tasksByAssignee.size === 0) {
    await interaction.editReply('No tasks for the latest meeting.');
    return;
  }

  let msg = '📋 **Tasks — Latest Meeting**\n\n';
  for (const [assignee, tasks] of tasksByAssignee) {
    msg += `👤 **${assignee}**\n`;
    for (const task of tasks) {
      msg += `  • ${task.title}${task.description ? ` — ${task.description}` : ''}\n`;
    }
    msg += '\n';
  }

  await interaction.editReply(msg);
}

// ── /meeting-summary ──────────────────────────────────────────────────────────

async function handleMeetingSummary(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  const meetingId = interaction.options.getString('meeting-id', true);
  const meeting   = await Meeting.findOne({ _id: meetingId, guildId: cfg.guildId });
  if (!meeting) {
    await interaction.editReply('Meeting not found (or belongs to another server).');
    return;
  }

  const entries = await TranscriptEntry.find({ meetingId: meeting._id }).sort({ startTimestamp: 1 });
  if (!entries.length) {
    await interaction.editReply('No transcript for this meeting.');
    return;
  }

  const transcript = entries.map((e) => `**${e.displayName}**: ${e.text}`).join('\n');
  const textChannel = await getTextChannel(cfg.textChannelId);
  await sendLongMessage(textChannel, transcript, `📝 **Transcript — ${meeting.title}**\n`);
  await interaction.editReply('Transcript posted.');
}

// ── /attendance ───────────────────────────────────────────────────────────────

async function handleAttendance(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  const meetingId = interaction.options.getString('meeting-id', true);
  const meeting   = await Meeting.findOne({ _id: meetingId, guildId: cfg.guildId });
  if (!meeting) {
    await interaction.editReply('Meeting not found (or belongs to another server).');
    return;
  }

  const speakers = await TranscriptEntry.distinct('displayName', { meetingId: meeting._id });
  if (!speakers.length) {
    await interaction.editReply('No attendance data for this meeting.');
    return;
  }

  let msg = `👥 **Attendance — ${meeting.title}**\n`;
  speakers.forEach((s: string) => { msg += `• ${s}\n`; });

  if (meeting.participants?.length) {
    const late    = meeting.participants.filter((p) => p.isLateJoiner).map((p) => p.displayName);
    const early   = meeting.participants.filter((p) => p.isEarlyLeaver).map((p) => p.displayName);
    const absent  = meeting.participants.filter((p) => p.isAbsent).map((p) => p.displayName);
    if (late.length)   msg += `\n⏰ Late: ${late.join(', ')}`;
    if (early.length)  msg += `\n🚪 Left early: ${early.join(', ')}`;
    if (absent.length) msg += `\n❌ Absent: ${absent.join(', ')}`;
  }

  await interaction.editReply(msg);
}

// ── /task-done ────────────────────────────────────────────────────────────────

async function handleTaskDone(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const cfg    = await requireGuildConfig(interaction.guildId!);
  const taskId = interaction.options.getString('task-id', true);

  const task = await Task.findById(taskId).lean();
  if (!task) {
    await interaction.editReply('Task not found.');
    return;
  }

  // Security: verify the task's meeting belongs to this guild
  const meeting = await Meeting.findOne({ _id: task.meetingId, guildId: cfg.guildId });
  if (!meeting) {
    await interaction.editReply('Task not found (or belongs to another server).');
    return;
  }

  await Task.findByIdAndUpdate(taskId, { status: 'completed' });
  await interaction.editReply(`✅ Task marked complete: **${task.title}**`);
}

// ── /meeting-history ──────────────────────────────────────────────────────────

async function handleMeetingHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const cfg = await requireGuildConfig(interaction.guildId!);

  const meetings = await Meeting.find({ guildId: cfg.guildId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  if (!meetings.length) {
    await interaction.editReply('No meetings found for this server.');
    return;
  }

  const statusIcon: Record<string, string> = {
    completed: '✅',
    active:    '🔴',
    scheduled: '📅',
    cancelled: '❌',
  };

  const typeLabel: Record<string, string> = {
    immediate: 'manual',
    oneoff:    'one-off',
    recurring: 'daily',
  };

  let msg = '📋 **Meeting History**\n\n';
  meetings.forEach((m, i) => {
    const date = (m.startTime ?? m.scheduledTime).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const icon  = statusIcon[m.status]  ?? '❓';
    const label = typeLabel[m.type]     ?? m.type;
    msg += `**${i + 1}.** ${icon} ${m.title} — ${date} — ${label}\n`;
    msg += `    \`ID: ${m._id}\`\n`;
  });

  await interaction.editReply(msg);
}

// ── Event registration ────────────────────────────────────────────────────────

export function registerEvents(): void {
  // Slash command handler
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split('_');
      if (action === 'editsummary')  await handleEditSummaryButton(interaction, id).catch(console.error);
      if (action === 'edittask')     await handleEditTaskButton(interaction, id).catch(console.error);
      if (action === 'skiptask')     await handleSkipTaskButton(interaction, id).catch(console.error);
      if (action === 'dispatchtasks') await handleDispatchButton(interaction, id).catch(console.error);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const [action, id] = interaction.customId.split('_');
      if (action === 'assigntask') await handleTaskAssignSelect(interaction, id).catch(console.error);
      return;
    }

    if (interaction.isModalSubmit()) {
      const [action, id] = interaction.customId.split('_');
      if (action === 'taskmodal') await handleTaskModalSubmit(interaction, id).catch(console.error);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case 'setup':             await handleSetup(interaction);           break;
        case 'config':            await handleConfigShow(interaction);      break;
        case 'start-meeting':     await handleStartMeeting(interaction);    break;
        case 'schedule-meeting':  await handleScheduleMeeting(interaction); break;
        case 'end-meeting':       await handleEndMeeting(interaction);      break;
        case 'assign-task':       await handleAssignTask(interaction);      break;
        case 'show-tasks':        await handleShowTasks(interaction);       break;
        case 'meeting-summary':   await handleMeetingSummary(interaction);   break;
        case 'attendance':        await handleAttendance(interaction);       break;
        case 'task-done':         await handleTaskDone(interaction);         break;
        case 'meeting-history':   await handleMeetingHistory(interaction);   break;
      }
    } catch (err) {
      console.error('[events] Command error:', err);
      const msg = err instanceof GuildNotConfiguredError
        ? err.message
        : 'An error occurred.';
      if (interaction.deferred) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, ephemeral: true });
    }
  });

  // DM message handler — captures admin's edited summary
  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guild) return; // only DMs
    await handleAdminDmMessage(message).catch(console.error);
  });
}
