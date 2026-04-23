import { config } from '../config';
import { transcribeAudio as deepgramTranscribe } from './deepgram';
import { transcribeAudio as googleTranscribe } from './google';

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  if (config.TRANSCRIPTION_PROVIDER === 'google') {
    return googleTranscribe(audioFilePath);
  }
  return deepgramTranscribe(audioFilePath);
}
