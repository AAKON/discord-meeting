import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  DMChannel,
  Message,
} from 'discord.js';
import { client } from './index';
import { GuildConfig, IGuildConfig } from '../db/models/guildConfig';
import { ApprovalRequest } from '../db/models/approvalRequest';
import { Task } from '../db/models/task';
import { Meeting } from '../db/models/meeting';
import { getTextChannel } from '../utils/discord';
import { sendLongMessage } from './utils';

interface TaskItem {
  title: string;
  description?: string;
}

interface ReassignItem {
  taskId: string;
  assignedTo: string;
  taskMsg: string;
  cfg: IGuildConfig;
}

// adminUserId → meetingId, held between button click and follow-up DM message
const pendingEdits = new Map<string, string>();

// adminUserId → queue of unmatched tasks waiting for admin to specify the correct member
const pendingReassignments = new Map<string, ReassignItem[]>();

// ── Start workflow ────────────────────────────────────────────────────────────

export async function startApprovalWorkflow(
  meetingId: string,
  cfg: IGuildConfig,
  summary: string,
  tasksByAssignee: Map<string, TaskItem[]>
): Promise<void> {
  let adminUser;
  try {
    adminUser = await client.users.fetch(cfg.adminUserId);
  } catch {
    console.error(`[approval] Could not fetch admin ${cfg.adminUserId}`);
    return;
  }

  let taskBlock = '';
  if (tasksByAssignee.size > 0) {
    taskBlock = '\n\n**Tasks:**\n';
    for (const [assignee, tasks] of tasksByAssignee) {
      taskBlock += `👤 **${assignee}**\n`;
      for (const t of tasks) {
        taskBlock += `  • ${t.title}${t.description ? ` — ${t.description}` : ''}\n`;
      }
    }
  }

  const content =
    `📋 **Meeting Summary — Approval Required**\n\n` +
    `${summary}${taskBlock}\n\n` +
    `Approve to dispatch tasks to assignees, or edit the summary first.`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${meetingId}`)
      .setLabel('✅ Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`edit_${meetingId}`)
      .setLabel('✏️ Edit then Approve')
      .setStyle(ButtonStyle.Secondary)
  );

  const dm       = await adminUser.createDM();
  const adminMsg = await dm.send({ content, components: [row] });

  await ApprovalRequest.create({
    meetingId,
    adminUserId: cfg.adminUserId,
    adminMessageId: adminMsg.id,
    originalSummary: summary,
    status: 'pending',
    sentToAdminAt: new Date(),
  });

  const textChannel = await getTextChannel(cfg.textChannelId);
  await textChannel.send('📬 Summary sent to admin for review. Tasks dispatched after approval.');
  console.log(`[approval] Workflow started for meeting ${meetingId}`);
}

// ── Button: Approve ───────────────────────────────────────────────────────────

export async function handleApproveButton(
  interaction: ButtonInteraction,
  meetingId: string
): Promise<void> {
  await interaction.deferUpdate();

  const approval = await ApprovalRequest.findOne({ meetingId, status: 'pending' });
  if (!approval) {
    await interaction.followUp({ content: 'Request not found or already processed.', ephemeral: true });
    return;
  }

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) return;

  const cfg = await GuildConfig.findOne({ guildId: meeting.guildId, isActive: true });
  if (!cfg) return;

  const summaryToPost = approval.editedSummary ?? approval.originalSummary;

  await ApprovalRequest.findByIdAndUpdate(approval._id, { status: 'approved', approvedAt: new Date() });
  await Task.updateMany({ meetingId }, { approvedByAdmin: true });

  const textChannel = await getTextChannel(cfg.textChannelId);
  await sendLongMessage(textChannel, summaryToPost, '📋 **Summary**\n');
  await dispatchTasksToAssignees(meetingId, cfg);
  await textChannel.send('✅ Meeting ended.');

  await interaction.editReply({ content: '✅ Approved. Tasks dispatched.', components: [] });
  console.log(`[approval] Meeting ${meetingId} approved`);
}

// ── Button: Edit then Approve ─────────────────────────────────────────────────

export async function handleEditButton(
  interaction: ButtonInteraction,
  meetingId: string
): Promise<void> {
  await interaction.deferUpdate();
  pendingEdits.set(interaction.user.id, meetingId);
  await interaction.editReply({
    content: '✏️ Send your edited summary as the next message in this DM.',
    components: [],
  });
}

// ── DM message handler — routes to edit or reassignment flow ──────────────────

export async function handleAdminEditMessage(message: Message): Promise<void> {
  // Priority 1: summary edit flow
  const meetingId = pendingEdits.get(message.author.id);
  if (meetingId) {
    pendingEdits.delete(message.author.id);
    await processSummaryEdit(message, meetingId);
    return;
  }

  // Priority 2: task reassignment flow
  const queue = pendingReassignments.get(message.author.id);
  if (queue?.length) {
    await processReassignmentReply(message, queue);
    return;
  }
}

async function processSummaryEdit(message: Message, meetingId: string): Promise<void> {
  const approval = await ApprovalRequest.findOne({
    meetingId,
    adminUserId: message.author.id,
    status: 'pending',
  });
  if (!approval) return;

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) return;

  const cfg = await GuildConfig.findOne({ guildId: meeting.guildId, isActive: true });
  if (!cfg) return;

  await ApprovalRequest.findByIdAndUpdate(approval._id, {
    editedSummary: message.content,
    status: 'approved',
    approvedAt: new Date(),
  });
  await Task.updateMany({ meetingId }, { approvedByAdmin: true });

  const textChannel = await getTextChannel(cfg.textChannelId);
  await sendLongMessage(textChannel, message.content, '📋 **Summary**\n');
  await dispatchTasksToAssignees(meetingId, cfg);
  await textChannel.send('✅ Meeting ended.');

  await message.reply('✅ Summary saved and tasks dispatched.');
  console.log(`[approval] Meeting ${meetingId} approved with edited summary`);
}

// ── Dispatch tasks to assignees ───────────────────────────────────────────────

export async function dispatchTasksToAssignees(
  meetingId: string,
  cfg: IGuildConfig
): Promise<void> {
  const tasks = await Task.find({ meetingId, approvedByAdmin: true }).lean();
  if (!tasks.length) return;

  const guild = client.guilds.cache.get(cfg.guildId);

  // Populate member cache for accurate matching
  try { await guild?.members.fetch(); } catch { /* large guild — use existing cache */ }

  const textChannel = await getTextChannel(cfg.textChannelId);
  const unmatched: ReassignItem[] = [];

  for (const task of tasks) {
    const taskMsg =
      `📌 **Task from standup:**\n**${task.title}**` +
      `${task.description ? `\n${task.description}` : ''}`;

    const member = guild?.members.cache.find(
      (m) =>
        m.displayName.toLowerCase() === task.assignedTo.toLowerCase() ||
        m.user.username.toLowerCase() === task.assignedTo.toLowerCase()
    );

    if (member) {
      try {
        await member.send(taskMsg);
      } catch {
        // DMs disabled — fall through to channel post
        await textChannel.send(`<@${member.id}> ${taskMsg}`);
      }
    } else {
      unmatched.push({
        taskId: task._id.toString(),
        assignedTo: task.assignedTo,
        taskMsg,
        cfg,
      });
    }
  }

  if (unmatched.length) {
    await startReassignmentFlow(cfg.adminUserId, unmatched);
  }
}

// ── Reassignment flow ─────────────────────────────────────────────────────────

async function startReassignmentFlow(adminUserId: string, items: ReassignItem[]): Promise<void> {
  let adminUser;
  try {
    adminUser = await client.users.fetch(adminUserId);
  } catch {
    console.error(`[approval] Could not fetch admin for reassignment ${adminUserId}`);
    return;
  }

  pendingReassignments.set(adminUserId, items);
  await sendReassignPrompt(adminUser.dmChannel ?? await adminUser.createDM(), items[0]);
}

async function sendReassignPrompt(dm: DMChannel, item: ReassignItem): Promise<void> {
  await dm.send(
    `❓ **No Discord member found for "${item.assignedTo}"**\n` +
    `Task: **${item.taskMsg.replace(/\*\*/g, '').trim()}**\n\n` +
    `Reply with their Discord @mention or exact username, or reply \`skip\` to skip this task.`
  );
}

async function processReassignmentReply(message: Message, queue: ReassignItem[]): Promise<void> {
  const current = queue[0];
  const reply   = message.content.trim();
  const guild   = client.guilds.cache.get(current.cfg.guildId);
  const textChannel = await getTextChannel(current.cfg.textChannelId);

  if (reply.toLowerCase() === 'skip') {
    await message.reply(`⏭️ Skipped task for **${current.assignedTo}**.`);
  } else {
    const mentionMatch = reply.match(/^<@!?(\d+)>$/);
    const member = mentionMatch
      ? guild?.members.cache.get(mentionMatch[1])
      : guild?.members.cache.find(
          (m) =>
            m.user.username.toLowerCase() === reply.toLowerCase() ||
            m.displayName.toLowerCase() === reply.toLowerCase()
        );

    if (member) {
      try {
        await member.send(current.taskMsg);
        await message.reply(`✅ Task sent to **${member.displayName}**.`);
      } catch {
        await textChannel.send(`<@${member.id}> ${current.taskMsg}`);
        await message.reply(`✅ Task posted in channel (${member.displayName} has DMs disabled).`);
      }
      await Task.findByIdAndUpdate(current.taskId, { assignedTo: member.displayName });
    } else {
      await message.reply(`❌ Member **${reply}** not found. Skipping this task.`);
    }
  }

  queue.shift();

  if (queue.length > 0) {
    await sendReassignPrompt(message.channel as DMChannel, queue[0]);
  } else {
    pendingReassignments.delete(message.author.id);
    await (message.channel as DMChannel).send('✅ All unmatched tasks processed.');
  }
}
