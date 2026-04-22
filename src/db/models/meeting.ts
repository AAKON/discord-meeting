import mongoose, { Document, Schema } from 'mongoose';

export type MeetingStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type MeetingType = 'immediate' | 'oneoff' | 'recurring';

export interface IParticipant {
  userId: string;
  displayName: string;
  joinTime: Date;
  leaveTime?: Date;
  isLateJoiner: boolean;
  isEarlyLeaver: boolean;
  isAbsent: boolean;
}

export interface IMeeting extends Document {
  title: string;
  type: MeetingType;
  scheduledTime: Date;
  startTime?: Date;
  endTime?: Date;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  status: MeetingStatus;
  participants?: IParticipant[];
}

const ParticipantSchema = new Schema<IParticipant>({
  userId: { type: String, required: true },
  displayName: { type: String, required: true },
  joinTime: { type: Date, required: true },
  leaveTime: { type: Date },
  isLateJoiner: { type: Boolean, default: false },
  isEarlyLeaver: { type: Boolean, default: false },
  isAbsent: { type: Boolean, default: false },
});

const MeetingSchema = new Schema<IMeeting>(
  {
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ['immediate', 'oneoff', 'recurring'],
      required: true,
      default: 'immediate',
    },
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
    participants: [ParticipantSchema],
  },
  { timestamps: true }
);

export const Meeting = mongoose.model<IMeeting>('Meeting', MeetingSchema);
