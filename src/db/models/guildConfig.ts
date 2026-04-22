import mongoose, { Document, Schema } from 'mongoose';

export interface IGuildConfig extends Document {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  timezone: string;
  adminUserId: string;
  meetingTime: string;
  meetingDurationMinutes: number;
  reminderMinutesBefore: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GuildConfigSchema = new Schema<IGuildConfig>(
  {
    guildId: { type: String, required: true, unique: true },
    voiceChannelId: { type: String, required: true },
    textChannelId: { type: String, required: true },
    timezone: { type: String, required: true, default: 'UTC' },
    adminUserId: { type: String, required: true },
    meetingTime: { type: String, required: true },
    meetingDurationMinutes: { type: Number, required: true, default: 30 },
    reminderMinutesBefore: { type: Number, required: true, default: 5 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const GuildConfig = mongoose.model<IGuildConfig>('GuildConfig', GuildConfigSchema);
