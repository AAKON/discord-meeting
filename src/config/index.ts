import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().min(1),
    GROQ_API_KEY: z.string().min(1),
    TRANSCRIPTION_PROVIDER: z.enum(['deepgram', 'google']).default('deepgram'),
    DEEPGRAM_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    GOOGLE_STT_LANGUAGE: z.string().default('bn-BD'),
  })
  .refine(
    (data) => data.TRANSCRIPTION_PROVIDER !== 'deepgram' || !!data.DEEPGRAM_API_KEY,
    { message: 'DEEPGRAM_API_KEY required when TRANSCRIPTION_PROVIDER=deepgram', path: ['DEEPGRAM_API_KEY'] }
  )
  .refine(
    (data) => data.TRANSCRIPTION_PROVIDER !== 'google' || !!data.GOOGLE_API_KEY,
    { message: 'GOOGLE_API_KEY required when TRANSCRIPTION_PROVIDER=google', path: ['GOOGLE_API_KEY'] }
  );

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
