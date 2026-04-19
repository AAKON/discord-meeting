import mongoose from 'mongoose';
import { config } from '../config';

export async function connectDB(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  console.log('MongoDB connected');
}
