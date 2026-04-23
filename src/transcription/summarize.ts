import OpenAI from 'openai';
import { config } from '../config';

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export async function summarizeMeeting(
  entries: { displayName: string; text: string }[]
): Promise<string> {
  const conversation = entries.map((e) => `${e.displayName}: ${e.text}`).join('\n');

  const response = await client.chat.completions.create({
    model: config.OPENAI_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content:
          'You are a meeting summarizer. The conversation may be in Bangla, English, or mixed. Respond in English. List: 1) Key discussion points, 2) Decisions made, 3) Action items. Keep it concise.',
      },
      {
        role: 'user',
        content: `Summarize this meeting conversation:\n\n${conversation}`,
      },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}
