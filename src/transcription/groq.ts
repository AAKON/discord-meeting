import fs from 'fs';
import Groq from 'groq-sdk';
import { config } from '../config';

const client = new Groq({ apiKey: config.GROQ_API_KEY });

/**
 * Transcribe audio using Groq's hosted Whisper large-v3-turbo.
 *
 * Why this model:
 *  - Whisper large-v3 architecture → excellent Bangla + English code-switching
 *  - Runs on Groq LPU hardware → ~10× faster than OpenAI's Whisper endpoint
 *  - Free tier: 6,000 audio-minutes / day (effectively unlimited for a standup bot)
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioFilePath),
    model: 'whisper-large-v3-turbo',
    language: config.OPENAI_STT_LANGUAGE, // reuse the same 'bn' language config
    response_format: 'json',              // 'json' gives a typed { text: string } response
    temperature: 0,
  });

  return transcription.text?.trim() ?? '';
}
