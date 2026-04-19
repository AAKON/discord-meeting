import mongoose, { Document, Schema } from 'mongoose';

export type MeetingStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';

export interface IMeeting extends Document {
  title: string;
  scheduledTime: Date;
  startTime?: Date;
  endTime?: Date;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  status: MeetingStatus;
}

const MeetingSchema = new Schema<IMeeting>(
  {
    title: { type: String, required: true },
    scheduledTime: { type: Date, required: true },
    startTime: { type: Date },
    endTime: { type: Date },
    guildId: { type: String, required: true },
    voiceChannelId: { type: String, required: true },
    textChannelId: { type: String, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'active', 'completed', 'cancelled'],
      default: 'scheduled',
    },
  },
  { timestamps: true }
);

export const Meeting = mongoose.model<IMeeting>('Meeting', MeetingSchema);
