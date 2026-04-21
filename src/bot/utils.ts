/**
 * Utility functions for Discord message handling
 */

const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Split a large message into multiple chunks that fit Discord's 4000 character limit
 * Tries to split at line breaks to avoid cutting off mid-sentence
 */
export function splitMessage(content: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  if (content.length <= limit) {
    return [content];
  }

  const messages: string[] = [];
  let currentMessage = '';

  const lines = content.split('\n');

  for (const line of lines) {
    const lineWithNewline = currentMessage ? line : line; // Don't add newline at start
    const testMessage = currentMessage + (currentMessage ? '\n' : '') + lineWithNewline;

    if (testMessage.length > limit) {
      // Current line doesn't fit
      if (currentMessage.length > 0) {
        messages.push(currentMessage);
        currentMessage = line;
      } else {
        // Single line is too long, force add it
        messages.push(line);
        currentMessage = '';
      }
    } else {
      currentMessage = testMessage;
    }
  }

  if (currentMessage.length > 0) {
    messages.push(currentMessage);
  }

  return messages;
}

/**
 * Send a message that might be too long by splitting into multiple messages
 */
export async function sendLongMessage(
  channel: any,
  content: string,
  prefix: string = ''
): Promise<void> {
  const chunks = splitMessage(content);

  for (let i = 0; i < chunks.length; i++) {
    const chunkPrefix = i === 0 ? prefix : `**[continued...]**`;
    const message = chunkPrefix ? `${chunkPrefix}\n${chunks[i]}` : chunks[i];
    await channel.send(message);
  }
}
