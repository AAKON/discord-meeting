import mongoose, { Document, Schema } from 'mongoose';

export interface ITranscriptEntry extends Document {
  meetingId: mongoose.Types.ObjectId;
  discordUserId: string;
  displayName: string;
  startTimestamp: Date;
  endTimestamp: Date;
  text: string;
  chunkIndex: number;
}

const TranscriptEntrySchema = new Schema<ITranscriptEntry>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true },
    discordUserId: { type: String, required: true },
    displayName: { type: String, required: true },
    startTimestamp: { type: Date, required: true },
    endTimestamp: { type: Date, required: true },
    text: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
  },
  { timestamps: true }
);

export const TranscriptEntry = mongoose.model<ITranscriptEntry>(
  'TranscriptEntry',
  TranscriptEntrySchema
);
