import { ChannelType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure StandupBot for this server (admin only)')
    .addChannelOption((opt) =>
      opt
        .setName('voice-channel')
        .setDescription('Voice channel the bot joins for meetings')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)
    )
    .addChannelOption((opt) =>
      opt
        .setName('text-channel')
        .setDescription('Text channel where transcripts are posted')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('meeting-time')
        .setDescription('Daily standup time in HH:MM (24h)')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('timezone')
        .setDescription('Timezone, e.g. Asia/Dhaka, UTC, America/New_York')
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('duration')
        .setDescription('Meeting duration in minutes (default: 30)')
        .setMinValue(5)
        .setMaxValue(180)
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('reminder')
        .setDescription('Minutes before meeting to send reminder (default: 5)')
        .setMinValue(1)
        .setMaxValue(60)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('View current bot configuration')
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Display current server config')
    ),

  new SlashCommandBuilder()
    .setName('schedule-meeting')
    .setDescription('Schedule a one-off meeting at a specific date and time')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Meeting title').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('date')
        .setDescription('Date in YYYY-MM-DD format')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('time')
        .setDescription('Time in HH:MM (24h) format')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('participants')
        .setDescription('Space-separated @mentions of expected participants (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('start-meeting')
    .setDescription('Start a meeting immediately'),

  new SlashCommandBuilder()
    .setName('end-meeting')
    .setDescription('End the active meeting and post transcript'),

  new SlashCommandBuilder()
    .setName('assign-task')
    .setDescription('Manually assign a task to someone during a meeting')
    .addUserOption((opt) =>
      opt.setName('assigned-to').setDescription('The server member to assign the task to').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Task title').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('Task details (optional)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('show-tasks')
    .setDescription('Show all tasks from the latest meeting grouped by assignee'),

  new SlashCommandBuilder()
    .setName('task-done')
    .setDescription('Mark a task as complete')
    .addStringOption((opt) =>
      opt.setName('task-id').setDescription('Task ID to mark complete').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('meeting-history')
    .setDescription('List the last 10 meetings for this server'),

  new SlashCommandBuilder()
    .setName('meeting-summary')
    .setDescription('View the full transcript and summary of a specific meeting')
    .addStringOption((opt) =>
      opt.setName('meeting-id').setDescription('Meeting ID').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('View attendance for a specific meeting')
    .addStringOption((opt) =>
      opt.setName('meeting-id').setDescription('Meeting ID').setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
    body: commands,
  });
  console.log('[commands] Global slash commands registered');
}
