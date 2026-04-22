import { connectDB } from './db/mongoose';
import { startTranscriptionWorker } from './transcription/worker';
import { registerCommands } from './bot/commands';
import { registerEvents } from './bot/events';
import { startAllSchedulers, rescheduleOneOffMeetings } from './scheduler/cron';
import { client } from './bot/index';
import { config } from './config';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits, TextChannel } from 'discord.js';
import { GuildConfig } from './db/models/guildConfig';
import mongoose from 'mongoose';
import { startVoiceCapture, resetCapture } from './voice/capture';
import { transcriptionQueue } from './queue';
import { buildParticipantMap, getTextChannel } from './utils/discord';
import { meetingState } from './bot/meetingState';

const MAX_RECONNECT_ATTEMPTS = 3;

async function attemptReconnect(meetingId: string, guildId: string, attempt = 1): Promise<void> {
  const cfg = await GuildConfig.findOne({ guildId, isActive: true });

  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    console.error('[reconnect] All attempts failed. Alerting text channel.');
    if (cfg) {
      try {
        const ch = await getTextChannel(cfg.textChannelId);
        await ch.send('⚠️ Bot disconnected from voice channel and could not reconnect. Please restart the meeting.');
      } catch (e) {
        console.error('[reconnect] Failed to send alert:', e);
      }
    }
    return;
  }

  if (!cfg) {
    console.error(`[reconnect] No config for guild ${guildId}`);
    return;
  }

  console.log(`[reconnect] Attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');

    const connection = joinVoiceChannel({
      channelId: cfg.voiceChannelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const active = meetingState.get(guildId);
    if (active) {
      meetingState.set(guildId, { ...active, connection });
    }

    console.log('[reconnect] Reconnected to voice channel.');

    resetCapture(meetingId);
    const participants = buildParticipantMap(guildId, cfg.voiceChannelId);
    startVoiceCapture(connection, meetingId, participants);
    console.log('[reconnect] Voice capture restarted.');

    connection.on('stateChange', (_old, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected && meetingState.has(guildId)) {
        attemptReconnect(meetingId, guildId, 1).catch(console.error);
      }
    });
  } catch (err) {
    console.error(`[reconnect] Attempt ${attempt} failed:`, err);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    await attemptReconnect(meetingId, guildId, attempt + 1);
  }
}

async function main(): Promise<void> {
  await connectDB();
  console.log('[app] DB connected');

  startTranscriptionWorker();
  console.log('[app] Transcription worker started');

  registerEvents();

  client.once('clientReady', async () => {
    console.log(`[app] Bot ready as ${client.user?.tag}`);
    await registerCommands();
    await startAllSchedulers();
    await rescheduleOneOffMeetings();
    console.log('[app] Schedulers started');
  });

  client.on('guildCreate', async (guild) => {
    try {
      const channel = guild.channels.cache
        .filter((ch) => ch.type === ChannelType.GuildText)
        .find((ch) => guild.members.me?.permissionsIn(ch).has(PermissionFlagsBits.SendMessages) ?? false);

      if (channel?.isTextBased()) {
        await (channel as TextChannel).send(
          "👋 Hi! I'm **StandupBot** — I record daily standups, transcribe per speaker, and extract action items automatically.\n\nHave a **server admin** run `/setup` to configure me."
        );
      }
    } catch (err) {
      console.error('[guildCreate] Failed to send welcome message:', err);
    }
  });

  client.on('guildDelete', async (guild) => {
    try {
      await GuildConfig.findOneAndUpdate({ guildId: guild.id }, { isActive: false });
      console.log(`[guildDelete] Deactivated config for guild ${guild.id}`);
    } catch (err) {
      console.error('[guildDelete] Error:', err);
    }
  });

  client.on('voiceStateUpdate', (_oldState, newState) => {
    const guildId = newState.guild?.id;
    if (!guildId) return;

    const active = meetingState.get(guildId);
    if (!active) return;

    if (newState.id === client.user?.id && !newState.channelId) {
      console.warn('[app] Bot left voice channel unexpectedly. Reconnecting...');
      attemptReconnect(active.meetingId, guildId).catch(console.error);
    }
  });

  try {
    console.log('[app] Logging in to Discord...');
    await Promise.race([
      client.login(config.DISCORD_TOKEN),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Discord login timeout after 30s')), 30_000)
      ),
    ]);
  } catch (err) {
    console.error('[app] Discord login error:', err);
    throw err;
  }
}

process.on('uncaughtException', (err) => {
  if (err.message?.includes('DecryptionFailed') || err.message?.includes('UnencryptedWhenPassthroughDisabled')) return;
  console.error('[app] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled rejection:', reason);
});

async function shutdown(): Promise<void> {
  console.log('[app] Shutting down...');
  try {
    for (const active of meetingState.values()) {
      active.connection.destroy();
    }
    await transcriptionQueue.close();
    await mongoose.connection.close();
  } catch (err) {
    console.error('[app] Shutdown error:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown().catch(console.error); });
process.on('SIGINT',  () => { shutdown().catch(console.error); });

main().catch((err) => {
  console.error('[app] Fatal startup error:', err);
  process.exit(1);
});
