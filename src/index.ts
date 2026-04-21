import { connectDB } from './db/mongoose';
import { startTranscriptionWorker } from './transcription/worker';
import { registerCommands } from './bot/commands';
import { registerEvents, getActiveMeetingId, getActiveConnection, setActiveConnection } from './bot/events';
import { startScheduler } from './scheduler/cron';
import { client } from './bot/index';
import { config } from './config';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { TextChannel } from 'discord.js';
import mongoose from 'mongoose';
import { startVoiceCapture, resetCapture } from './voice/capture';
import { transcriptionQueue } from './queue';
import { buildParticipantMap } from './utils/discord';

const MAX_RECONNECT_ATTEMPTS = 3;

async function attemptReconnect(meetingId: string, attempt = 1): Promise<void> {
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    console.error('[reconnect] All attempts failed. Alerting text channel.');
    try {
      const ch = await client.channels.fetch(config.MEETING_TEXT_CHANNEL_ID);
      if (ch && ch.isTextBased()) {
        await (ch as TextChannel).send(
          '⚠️ Bot disconnected from voice channel and could not reconnect. Please restart the meeting.'
        );
      }
    } catch (e) {
      console.error('[reconnect] Failed to send alert:', e);
    }
    return;
  }

  console.log(`[reconnect] Attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);

  try {
    const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
    if (!guild) throw new Error('Guild not found');

    const connection = joinVoiceChannel({
      channelId: config.MEETING_VOICE_CHANNEL_ID,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    setActiveConnection(connection);
    console.log('[reconnect] Reconnected to voice channel.');

    // Discard broken capture streams and restart fresh on new connection
    resetCapture(meetingId);
    const reconnectGuild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
    if (reconnectGuild) {
      const participants = buildParticipantMap(reconnectGuild.id);
      startVoiceCapture(connection, meetingId, participants);
      console.log('[reconnect] Voice capture restarted.');
    }

    connection.on('stateChange', (_old, newState) => {
      if (
        newState.status === VoiceConnectionStatus.Disconnected &&
        getActiveMeetingId()
      ) {
        attemptReconnect(meetingId, 1).catch(console.error);
      }
    });
  } catch (err) {
    console.error(`[reconnect] Attempt ${attempt} failed:`, err);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    await attemptReconnect(meetingId, attempt + 1);
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
    startScheduler();
    console.log('[app] Scheduler started');
  });

  client.on('voiceStateUpdate', (_oldState, newState) => {
    const meetingId = getActiveMeetingId();
    const conn = getActiveConnection();
    if (!meetingId || !conn) return;

    if (
      newState.id === client.user?.id &&
      !newState.channelId
    ) {
      console.warn('[app] Bot left voice channel unexpectedly. Reconnecting...');
      attemptReconnect(meetingId).catch(console.error);
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
  // DAVE protocol sends mixed encrypted/unencrypted packets — non-fatal noise
  if (err.message?.includes('DecryptionFailed') || err.message?.includes('UnencryptedWhenPassthroughDisabled')) return;
  console.error('[app] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled rejection:', reason);
});

async function shutdown(): Promise<void> {
  console.log('[app] Shutting down...');
  try {
    getActiveConnection()?.destroy();
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
