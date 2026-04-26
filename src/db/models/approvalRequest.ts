import mongoose, { Document, Schema } from 'mongoose';

export type ApprovalStatus = 'pending' | 'approved';

export interface IApprovalRequest extends Document {
  meetingId: mongoose.Types.ObjectId;
  adminUserId: string;
  adminMessageId: string;
  status: ApprovalStatus;
  originalSummary: string;
  editedSummary?: string;
  isPendingSummaryEdit: boolean;
  sentToAdminAt: Date;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApprovalRequestSchema = new Schema<IApprovalRequest>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    adminUserId: { type: String, required: true },
    adminMessageId: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved'],
      default: 'pending',
    },
    originalSummary: { type: String, required: true },
    editedSummary: { type: String },
    isPendingSummaryEdit: { type: Boolean, default: false },
    sentToAdminAt: { type: Date, required: true },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

export const ApprovalRequest = mongoose.model<IApprovalRequest>('ApprovalRequest', ApprovalRequestSchema);
