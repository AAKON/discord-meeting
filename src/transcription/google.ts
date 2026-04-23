import fs from 'fs';
import { config } from '../config';

interface GoogleSTTResponse {
  results?: {
    alternatives?: { transcript?: string }[];
  }[];
  error?: { message?: string };
}

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const audioBuffer = fs.readFileSync(audioFilePath);

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${config.GOOGLE_API_KEY ?? ''}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          audioChannelCount: 1,
          languageCode: config.GOOGLE_STT_LANGUAGE,
          enableAutomaticPunctuation: true,
          model: 'latest_long',
        },
        audio: { content: audioBuffer.toString('base64') },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google STT error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as GoogleSTTResponse;

  return (
    data.results
      ?.map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim() ?? ''
  );
}
