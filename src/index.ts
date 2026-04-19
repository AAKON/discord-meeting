import { connectDB } from './db/mongoose';
import { startTranscriptionWorker } from './transcription/worker';
import { registerCommands } from './bot/commands';
import { registerEvents, getActiveMeetingId, getActiveConnection, setActiveConnection } from './bot/events';
import { startScheduler } from './scheduler/cron';
import { client } from './bot/index';
import { config } from './config';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { TextChannel } from 'discord.js';

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

  await client.login(config.DISCORD_TOKEN);
}

process.on('uncaughtException', (err) => {
  // DAVE protocol sends mixed encrypted/unencrypted packets — non-fatal noise
  if (err.message?.includes('DecryptionFailed') || err.message?.includes('UnencryptedWhenPassthroughDisabled')) return;
  console.error('[app] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled rejection:', reason);
});

main().catch((err) => {
  console.error('[app] Fatal startup error:', err);
  process.exit(1);
});
