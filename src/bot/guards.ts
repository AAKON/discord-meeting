import { IGuildConfig, GuildConfig } from '../db/models/guildConfig';

export class GuildNotConfiguredError extends Error {
  constructor() {
    super('Bot not configured. A server admin must run `/setup` first.');
    this.name = 'GuildNotConfiguredError';
  }
}

export async function requireGuildConfig(guildId: string): Promise<IGuildConfig> {
  const cfg = await GuildConfig.findOne({ guildId, isActive: true });
  if (!cfg) throw new GuildNotConfiguredError();
  return cfg;
}
