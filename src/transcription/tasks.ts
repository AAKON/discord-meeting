import OpenAI from 'openai';
import { config } from '../config';
import { Task } from '../db/models/task';
import mongoose from 'mongoose';

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

interface ExtractedTask {
  assignedTo: string;
  title: string;
  description?: string;
}

export async function extractTasksFromMeeting(
  meetingId: string,
  entries: { displayName: string; text: string }[]
): Promise<ExtractedTask[]> {
  if (entries.length === 0) return [];

  const conversation = entries.map((e) => `${e.displayName}: ${e.text}`).join('\n');

  try {
    const response = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `Extract all task assignments from this meeting conversation. The conversation may be in Bangla, English, or mixed.

Rules:
1. "assignedTo" — use the EXACT name as spoken in the conversation, do NOT translate
2. "title" — ALWAYS write in English; translate from Bangla if needed
3. "description" — ALWAYS write in English; translate from Bangla if needed; omit if not present

Return ONLY a JSON object with this exact format:
{"tasks": [{"assignedTo": "Person Name", "title": "Task title in English", "description": "optional details in English"}]}

If no tasks are assigned, return: {"tasks": []}

Conversation:
${conversation}`,
        },
      ],
    });

    const responseText = response.choices[0]?.message?.content ?? '{"tasks":[]}';

    let tasks: ExtractedTask[] = [];
    try {
      const parsed = JSON.parse(responseText);
      tasks = Array.isArray(parsed.tasks) ? parsed.tasks : Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn('[tasks] Failed to parse AI response as JSON, returning empty array');
      return [];
    }

    if (tasks.length > 0) {
      const savedTasks = await Promise.all(
        tasks.map((task) =>
          Task.create({
            meetingId: new mongoose.Types.ObjectId(meetingId),
            assignedTo: task.assignedTo || 'unassigned',
            title: task.title,
            description: task.description,
            status: 'assigned',
          })
        )
      );
      console.log(`[tasks] Extracted ${savedTasks.length} tasks from meeting ${meetingId}`);
    }

    return tasks;
  } catch (err) {
    console.error('[tasks] Error extracting tasks:', err);
    return [];
  }
}

export async function getTasksByAssignee(
  meetingId: string
): Promise<Map<string, ExtractedTask[]>> {
  const tasks = await Task.find({ meetingId }).lean();

  const tasksByAssignee = new Map<string, ExtractedTask[]>();

  for (const task of tasks) {
    const assignee = task.assignedTo || 'unassigned';
    if (!tasksByAssignee.has(assignee)) {
      tasksByAssignee.set(assignee, []);
    }
    tasksByAssignee.get(assignee)!.push({
      assignedTo: task.assignedTo,
      title: task.title,
      description: task.description,
    });
  }

  return tasksByAssignee;
}
