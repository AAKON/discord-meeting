import Groq from 'groq-sdk';
import fs from 'fs';
import { config } from '../config';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const stream = fs.createReadStream(audioFilePath);
  const result = await groq.audio.transcriptions.create({
    file: stream,
    model: 'whisper-large-v3',
  });
  return result.text;
}
