import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  DEEPGRAM_API_KEY: z.string().min(1),
  MEETING_VOICE_CHANNEL_ID: z.string().min(1),
  MEETING_TEXT_CHANNEL_ID: z.string().min(1),
  MEETING_TIME: z.string().regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM'),
  MEETING_DURATION_MINUTES: z.coerce.number().positive(),
  REMINDER_MINUTES_BEFORE: z.coerce.number().positive(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
