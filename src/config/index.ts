import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_STT_MODEL: z.string().default('whisper-1'),
    OPENAI_STT_LANGUAGE: z.string().default('bn'),
    TRANSCRIPTION_PROVIDER: z.enum(['deepgram', 'google', 'openai', 'groq']).default('groq'),
    DEEPGRAM_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    GOOGLE_STT_LANGUAGE: z.string().default('bn-BD'),
    GROQ_API_KEY: z.string().optional(),
  })
  .refine(
    (data) => data.TRANSCRIPTION_PROVIDER !== 'deepgram' || !!data.DEEPGRAM_API_KEY,
    { message: 'DEEPGRAM_API_KEY required when TRANSCRIPTION_PROVIDER=deepgram', path: ['DEEPGRAM_API_KEY'] }
  )
  .refine(
    (data) => data.TRANSCRIPTION_PROVIDER !== 'google' || !!data.GOOGLE_API_KEY,
    { message: 'GOOGLE_API_KEY required when TRANSCRIPTION_PROVIDER=google', path: ['GOOGLE_API_KEY'] }
  )
  .refine(
    (data) => data.TRANSCRIPTION_PROVIDER !== 'groq' || !!data.GROQ_API_KEY,
    { message: 'GROQ_API_KEY required when TRANSCRIPTION_PROVIDER=groq', path: ['GROQ_API_KEY'] }
  );

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
