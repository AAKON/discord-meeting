import { config } from '../config';
import { transcribeAudio as deepgramTranscribe } from './deepgram';
import { transcribeAudio as googleTranscribe } from './google';
import { transcribeAudio as openaiTranscribe } from './openai';
import { transcribeAudio as groqTranscribe } from './groq';

export async function transcribeAudio(audioFilePath: string): Promise<string> {
  switch (config.TRANSCRIPTION_PROVIDER) {
    case 'google':
      return googleTranscribe(audioFilePath);
    case 'openai':
      return openaiTranscribe(audioFilePath);
    case 'groq':
      return groqTranscribe(audioFilePath);
    case 'deepgram':
    default:
      return deepgramTranscribe(audioFilePath);
  }
}
