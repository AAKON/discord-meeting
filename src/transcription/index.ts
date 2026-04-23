import { config } from '../config';
import { transcribeAudio as deepgramTranscribe } from './deepgram';
import { transcribeAudio as googleTranscribe } from './google';
import { transcribeAudio as openaiTranscribe } from './openai';

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  switch (config.TRANSCRIPTION_PROVIDER) {
    case 'google':
      return googleTranscribe(audioFilePath);
    case 'openai':
      return openaiTranscribe(audioFilePath);
    case 'deepgram':
    default:
      return deepgramTranscribe(audioFilePath);
  }
}
