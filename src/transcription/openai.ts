import fs from 'fs';
import OpenAI from 'openai';
import { config } from '../config';

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioFilePath),
    model: config.OPENAI_STT_MODEL,
    language: config.OPENAI_STT_LANGUAGE,
    response_format: 'text',
  });

  return typeof result === 'string' ? result.trim() : (result as { text?: string }).text?.trim() ?? '';
}
