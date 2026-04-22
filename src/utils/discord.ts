import { GuildMember, TextChannel } from 'discord.js';
import { client } from '../bot/index';

export function buildParticipantMap(guildId: string, voiceChannelId: string): Map<string, string> {
  const guild = client.guilds.cache.get(guildId);
  const map = new Map<string, string>();
  if (!guild) return map;
  const vc = guild.channels.cache.get(voiceChannelId);
  if (!vc?.isVoiceBased()) return map;
  vc.members.forEach((member: GuildMember) => map.set(member.id, member.displayName));
  return map;
}

export function resolveGuildMemberName(guildId: string, userId: string): string {
  return client.guilds.cache.get(guildId)?.members.cache.get(userId)?.displayName ?? userId;
}

export async function getTextChannel(textChannelId: string): Promise<TextChannel> {
  const ch = await client.channels.fetch(textChannelId);
  if (!ch?.isTextBased()) throw new Error(`Text channel ${textChannelId} not found`);
  return ch as TextChannel;
}
