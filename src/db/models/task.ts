import mongoose, { Document, Schema } from 'mongoose';

export interface ITask extends Document {
  meetingId: mongoose.Types.ObjectId;
  assignedTo: string;
  title: string;
  description?: string;
  dueDate?: Date;
  status: 'assigned' | 'in_progress' | 'completed' | 'pending';
  assignedBy?: string;
  approvedByAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true },
    assignedTo: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date },
    status: {
      type: String,
      enum: ['assigned', 'in_progress', 'completed', 'pending'],
      default: 'assigned',
    },
    assignedBy: { type: String },
    approvedByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Task = mongoose.model<ITask>('Task', TaskSchema);
