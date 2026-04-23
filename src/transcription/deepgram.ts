import fs from 'fs';
import { config } from '../config';

interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
      }[];
    }[];
  };
}

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const audioBuffer = fs.readFileSync(audioFilePath);

  const response = await fetch(
    'https://api.deepgram.com/v1/listen?language=bn&model=nova-3&smart_format=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.DEEPGRAM_API_KEY ?? ''}`,
        'Content-Type': 'audio/wav',
      },
      body: audioBuffer,
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Deepgram error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as DeepgramResponse;
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}
