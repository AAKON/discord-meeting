import cron from 'node-cron';
import { TextChannel } from 'discord.js';
import { client } from '../bot/index';
import { GuildConfig, IGuildConfig } from '../db/models/guildConfig';
import { Meeting, IMeeting } from '../db/models/meeting';
import { runMeetingStart, runMeetingEnd } from '../bot/meetingRunner';

type ScheduledTask = ReturnType<typeof cron.schedule>;

const activeCrons  = new Map<string, ScheduledTask[]>();
const activeOneOff = new Map<string, NodeJS.Timeout>(); // key: meetingId

function timeToCron(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${m} ${h} * * *`;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function subtractMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m - minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function startGuildScheduler(cfg: IGuildConfig): void {
  stopGuildScheduler(cfg.guildId);

  const reminderTime = subtractMinutes(cfg.meetingTime, cfg.reminderMinutesBefore);
  const endTime      = addMinutes(cfg.meetingTime, cfg.meetingDurationMinutes);
  const tz           = cfg.timezone;
  const tasks: ScheduledTask[] = [];

  tasks.push(
    cron.schedule(timeToCron(reminderTime), async () => {
      try {
        const ch = await client.channels.fetch(cfg.textChannelId);
        if (ch?.isTextBased()) {
          await (ch as TextChannel).send(
            `📅 Daily standup starts in ${cfg.reminderMinutesBefore} minutes. Please join the voice channel.`
          );
        }
      } catch (err) {
        console.error(`[cron:${cfg.guildId}] Reminder error:`, err);
      }
    }, { timezone: tz })
  );

  tasks.push(
    cron.schedule(timeToCron(cfg.meetingTime), async () => {
      try {
        await runMeetingStart(cfg, { title: 'Daily Standup', type: 'recurring' });
      } catch (err) {
        console.error(`[cron:${cfg.guildId}] Meeting start error:`, err);
      }
    }, { timezone: tz })
  );

  tasks.push(
    cron.schedule(timeToCron(endTime), async () => {
      try {
        await runMeetingEnd(cfg);
      } catch (err) {
        console.error(`[cron:${cfg.guildId}] Meeting end error:`, err);
      }
    }, { timezone: tz })
  );

  activeCrons.set(cfg.guildId, tasks);
  console.log(`[cron] Guild ${cfg.guildId} — ${cfg.meetingTime} ${tz}`);
}

export function stopGuildScheduler(guildId: string): void {
  const tasks = activeCrons.get(guildId);
  if (tasks) {
    tasks.forEach((t) => t.stop());
    activeCrons.delete(guildId);
  }
}

export function restartGuildScheduler(cfg: IGuildConfig): void {
  stopGuildScheduler(cfg.guildId);
  startGuildScheduler(cfg);
}

export async function startAllSchedulers(): Promise<void> {
  const configs = await GuildConfig.find({ isActive: true });
  for (const cfg of configs) {
    startGuildScheduler(cfg);
  }
  console.log(`[cron] Started schedulers for ${configs.length} guild(s)`);
}

export function scheduleOneOffMeeting(meeting: IMeeting, cfg: IGuildConfig): void {
  const delay = new Date(meeting.scheduledTime).getTime() - Date.now();
  if (delay <= 0) {
    console.warn(`[cron] One-off "${meeting.title}" is in the past, skipping`);
    return;
  }

  const meetingId = (meeting._id as { toString(): string }).toString();

  const handle = setTimeout(async () => {
    activeOneOff.delete(meetingId);
    try {
      await runMeetingStart(cfg, { title: meeting.title, type: 'oneoff', meetingId });
      setTimeout(async () => {
        try {
          await runMeetingEnd(cfg);
        } catch (err) {
          console.error(`[cron:oneoff:${meetingId}] End error:`, err);
        }
      }, cfg.meetingDurationMinutes * 60_000);
    } catch (err) {
      console.error(`[cron:oneoff:${meetingId}] Start error:`, err);
    }
  }, delay);

  activeOneOff.set(meetingId, handle);
  console.log(`[cron] One-off "${meeting.title}" in ${Math.round(delay / 60_000)} min`);
}

export async function rescheduleOneOffMeetings(): Promise<void> {
  const configs = await GuildConfig.find({ isActive: true });
  const cfgMap  = new Map(configs.map((c) => [c.guildId, c]));

  const pending = await Meeting.find({
    type: 'oneoff',
    status: 'scheduled',
    scheduledTime: { $gt: new Date() },
  });

  for (const meeting of pending) {
    const cfg = cfgMap.get(meeting.guildId);
    if (cfg) scheduleOneOffMeeting(meeting, cfg);
  }

  if (pending.length > 0) {
    console.log(`[cron] Rescheduled ${pending.length} pending one-off meeting(s)`);
  }
}

// Kept so index.ts import doesn't break until Step 11
export function startScheduler(): void {
  startAllSchedulers().catch((err) => console.error('[cron] startAllSchedulers error:', err));
}
