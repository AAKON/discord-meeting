import mongoose, { Document, Schema } from 'mongoose';

export interface ITask extends Document {
  meetingId: mongoose.Types.ObjectId;
  assignedTo: string;
  assignedDiscordId?: string;
  title: string;
  description?: string;
  dueDate?: Date;
  status: 'assigned' | 'in_progress' | 'completed' | 'pending' | 'skipped';
  assignedBy?: string;
  approvedByAdmin: boolean;
  dispatchedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true },
    assignedTo: { type: String, required: true },
    assignedDiscordId: { type: String },
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date },
    status: {
      type: String,
      enum: ['assigned', 'in_progress', 'completed', 'pending', 'skipped'],
      default: 'assigned',
    },
    assignedBy: { type: String },
    approvedByAdmin: { type: Boolean, default: false },
    dispatchedAt: { type: Date },
  },
  { timestamps: true }
);

export const Task = mongoose.model<ITask>('Task', TaskSchema);
