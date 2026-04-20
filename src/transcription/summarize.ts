import Groq from 'groq-sdk';
import { config } from '../config';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

export async function summarizeMeeting(
  entries: { displayName: string; text: string }[]
): Promise<string> {
  const conversation = entries.map((e) => `${e.displayName}: ${e.text}`).join('\n');

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are summarizing a meeting conversation that may be in Bangla, English, or mixed. Respond in English. List: 1) Key discussion points, 2) Decisions made, 3) Action items. Keep it concise.\n\nConversation:\n${conversation}`,
      },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}
