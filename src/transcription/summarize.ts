import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

const ai = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });

export async function summarizeMeeting(
  entries: { displayName: string; text: string }[]
): Promise<string> {
  const conversation = entries.map((e) => `${e.displayName}: ${e.text}`).join('\n');

  const response = await ai.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are a meeting summarizer. The conversation may be in Bangla, English, or mixed. Respond in English. List: 1) Key discussion points, 2) Decisions made, 3) Action items. Keep it concise.

Summarize this meeting conversation:

${conversation}`,
          },
        ],
      },
    ],
    config: { maxOutputTokens: 1024 },
  });

  return response.text ?? '';
}
