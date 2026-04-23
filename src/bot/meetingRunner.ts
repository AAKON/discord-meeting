import { GuildMember, VoiceState } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { client } from './index';
import { IGuildConfig } from '../db/models/guildConfig';
import { Meeting, MeetingType } from '../db/models/meeting';
import { TranscriptEntry } from '../db/models/transcript';
import { startVoiceCapture, stopVoiceCapture, stopUserCapture } from '../voice/capture';
import { summarizeMeeting } from '../transcription/summarize';
import { extractTasksFromMeeting } from '../transcription/tasks';
import { sendLongMessage } from './utils';
import { transcriptionQueue } from '../queue';
import { waitForQueueDrain } from '../utils/queue';
import { getTextChannel } from '../utils/discord';
import { meetingState } from './meetingState';
import { startApprovalWorkflow } from './approval';

export interface StartMeetingOpts {
  title: string;
  type: MeetingType;
  meetingId?: string;        // activates existing record rather than creating a new one
  invitedUserIds?: string[]; // ping on start, check absent after 5 min
}

export async function runMeetingStart(cfg: IGuildConfig, opts: StartMeetingOpts): Promise<void> {
  if (meetingState.has(cfg.guildId)) {
    console.warn(`[runner] Meeting already active in guild ${cfg.guildId}, skipping`);
    return;
  }

  const guild = client.guilds.cache.get(cfg.guildId) ?? await client.guilds.fetch(cfg.guildId);
  if (!guild) throw new Error(`Guild ${cfg.guildId} not found`);

  let meetingId: string;
  let invitedUserIds = opts.invitedUserIds ?? [];

  if (opts.meetingId) {
    const existing = await Meeting.findByIdAndUpdate(
      opts.meetingId,
      { status: 'active', startTime: new Date() },
      { new: true }
    );
    meetingId = opts.meetingId;
    if (!invitedUserIds.length && existing?.participants?.length) {
      invitedUserIds = existing.participants.map((p) => p.userId);
    }
  } else {
    const meeting = await Meeting.create({
      title: opts.title,
      type: opts.type,
      scheduledTime: new Date(),
      startTime: new Date(),
      guildId: cfg.guildId,
      voiceChannelId: cfg.voiceChannelId,
      textChannelId: cfg.textChannelId,
      status: 'active',
    });
    meetingId = meeting._id.toString();
  }

  const connection = joinVoiceChannel({
    channelId: cfg.voiceChannelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  const textChannel = await getTextChannel(cfg.textChannelId);

  const earlyLeaverListener = (oldState: VoiceState, newState: VoiceState) => {
    if (oldState.channelId !== cfg.voiceChannelId) return;
    if (newState.channelId === cfg.voiceChannelId) return;
    if (newState.id === client.user?.id) return;
    const displayName = oldState.member?.displayName ?? newState.id;
    stopUserCapture(meetingId, newState.id).catch(console.error);
    textChannel.send(`⚠️ **${displayName}** left the meeting early.`).catch(console.error);
  };
  client.on('voiceStateUpdate', earlyLeaverListener);

  meetingState.set(cfg.guildId, { meetingId, connection, earlyLeaverListener });

  const participants = new Map<string, string>();
  const vc = guild.channels.cache.get(cfg.voiceChannelId);
  if (vc?.isVoiceBased()) {
    vc.members.forEach((m: GuildMember) => participants.set(m.id, m.displayName));
  }

  startVoiceCapture(connection, meetingId, participants, {
    resolveDisplayName: (userId) => guild.members.cache.get(userId)?.displayName ?? userId,
    onLateJoiner: (_, displayName) => {
      textChannel.send(`🕐 **${displayName}** joined late.`).catch(console.error);
    },
  });

  await textChannel.send('🔴 Meeting started. Recording...');

  if (invitedUserIds.length) {
    await textChannel.send(`📢 ${invitedUserIds.map((id) => `<@${id}>`).join(' ')} Standup is starting now!`);

    const capturedMeetingId = meetingId;
    setTimeout(async () => {
      try {
        const voiceChannel = guild.channels.cache.get(cfg.voiceChannelId);
        if (!voiceChannel?.isVoiceBased()) return;
        const inVoice = new Set(voiceChannel.members.keys());
        const absent  = invitedUserIds.filter((id) => !inVoice.has(id));
        if (absent.length) {
          await textChannel.send(`❌ Not in voice: ${absent.map((id) => `<@${id}>`).join(', ')}`);
          await Meeting.updateOne(
            { _id: capturedMeetingId },
            { $set: { 'participants.$[elem].isAbsent': true } },
            { arrayFilters: [{ 'elem.userId': { $in: absent } }] }
          );
        }
      } catch (err) {
        console.error('[runner] Absent check error:', err);
      }
    }, 5 * 60_000);
  }

  console.log(`[runner] Meeting ${meetingId} started in guild ${cfg.guildId}`);
}

export async function runMeetingEnd(cfg: IGuildConfig): Promise<void> {
  const active = meetingState.get(cfg.guildId);
  if (!active) {
    console.warn(`[runner] No active meeting in guild ${cfg.guildId}`);
    return;
  }

  const { meetingId, connection, earlyLeaverListener } = active;
  meetingState.delete(cfg.guildId);

  if (earlyLeaverListener) client.off('voiceStateUpdate', earlyLeaverListener);

  await stopVoiceCapture(meetingId);
  connection.destroy();

  const endTime = new Date();
  await Meeting.findByIdAndUpdate(meetingId, { status: 'completed', endTime });
  await waitForQueueDrain(transcriptionQueue);

  const meeting  = await Meeting.findById(meetingId);
  const entries  = await TranscriptEntry.find({ meetingId }).sort({ startTimestamp: 1 });
  const textChannel = await getTextChannel(cfg.textChannelId);

  if (meeting?.startTime && meeting.endTime) {
    const durationMs = meeting.endTime.getTime() - meeting.startTime.getTime();
    const mins = Math.floor(durationMs / 60_000);
    const secs = Math.floor((durationMs % 60_000) / 1_000);
    await textChannel.send(`⏱️ **Meeting Duration**: ${mins}m ${secs}s`);
  }

  if (!entries.length) {
    await textChannel.send('No speech recorded.');
    await textChannel.send('✅ Meeting ended.');
    console.log(`[runner] Meeting ${meetingId} ended (no speech)`);
    return;
  }

  // Post raw transcript immediately — no approval needed
  const transcript = entries.map((e) => `**${e.displayName}**: ${e.text}`).join('\n');
  await sendLongMessage(textChannel, transcript, '📝 **Conversation**\n');

  // Run AI pipeline, then hand off to approval workflow
  await extractTasksFromMeeting(meetingId, entries);
  const summary = await summarizeMeeting(entries);

  await startApprovalWorkflow(meetingId, cfg, summary);

  console.log(`[runner] Meeting ${meetingId} ended, awaiting admin approval`);
}
