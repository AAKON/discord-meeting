import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config';

const commands = [
  new SlashCommandBuilder()
    .setName('create-meeting')
    .setDescription('Create a scheduled meeting record')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Meeting title').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('time').setDescription('Scheduled time (ISO or HH:MM)').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('start-meeting')
    .setDescription('Manually start the meeting now'),

  new SlashCommandBuilder()
    .setName('end-meeting')
    .setDescription('Manually end the active meeting'),

  new SlashCommandBuilder()
    .setName('meeting-summary')
    .setDescription('Post the latest completed meeting transcript'),

  new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('Show who joined the last meeting'),
].map((cmd) => cmd.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID), {
    body: commands,
  });
  console.log('Slash commands registered');
}
