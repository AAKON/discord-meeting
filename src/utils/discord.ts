import { GuildMember, TextChannel } from 'discord.js';
import { client } from '../bot/index';
import { config } from '../config';

export function buildParticipantMap(guildId: string): Map<string, string> {
  const guild = client.guilds.cache.get(guildId);
  const map = new Map<string, string>();
  if (!guild) return map;
  const vc = guild.channels.cache.get(config.MEETING_VOICE_CHANNEL_ID);
  if (!vc || !vc.isVoiceBased()) return map;
  vc.members.forEach((member: GuildMember) => map.set(member.id, member.displayName));
  return map;
}

export function resolveGuildMemberName(guildId: string, userId: string): string {
  const guild = client.guilds.cache.get(guildId);
  return guild?.members.cache.get(userId)?.displayName ?? userId;
}

export async function getTextChannel(): Promise<TextChannel> {
  const ch = await client.channels.fetch(config.MEETING_TEXT_CHANNEL_ID);
  if (!ch || !ch.isTextBased()) throw new Error('Text channel not found');
  return ch as TextChannel;
}

export async function sendChunked(channel: TextChannel, text: string): Promise<void> {
  const MAX = 1900;
  const lines = text.split('\n');
  let chunk = '';
  for (const line of lines) {
    if (chunk.length + line.length + 1 > MAX) {
      await channel.send(chunk);
      chunk = line;
    } else {
      chunk = chunk ? `${chunk}\n${line}` : line;
    }
  }
  if (chunk) await channel.send(chunk);
}
