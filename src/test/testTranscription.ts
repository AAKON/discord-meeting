import path from 'path';
import { transcribeAudio } from '../transcription';

const samplePath = path.resolve(__dirname, '../../test/sample.wav');

(async () => {
  console.log(`Transcribing: ${samplePath}`);
  const text = await transcribeAudio(samplePath);
  console.log('Result:', text);
})().catch((err) => {
  console.error('Transcription test failed:', err);
  process.exit(1);
});
