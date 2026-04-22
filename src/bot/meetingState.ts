import { VoiceConnection } from '@discordjs/voice';
import { VoiceState } from 'discord.js';

export interface ActiveMeeting {
  meetingId: string;
  connection: VoiceConnection;
  earlyLeaverListener: ((oldState: VoiceState, newState: VoiceState) => void) | null;
}

const state = new Map<string, ActiveMeeting>();

export const meetingState = {
  set(guildId: string, meeting: ActiveMeeting): void {
    state.set(guildId, meeting);
  },
  get(guildId: string): ActiveMeeting | undefined {
    return state.get(guildId);
  },
  delete(guildId: string): void {
    state.delete(guildId);
  },
  has(guildId: string): boolean {
    return state.has(guildId);
  },
  values(): IterableIterator<ActiveMeeting> {
    return state.values();
  },
};
