import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { client } from './index';
import { GuildConfig, IGuildConfig } from '../db/models/guildConfig';
import { ApprovalRequest } from '../db/models/approvalRequest';
import { Task } from '../db/models/task';
import { Meeting } from '../db/models/meeting';
import { getTextChannel } from '../utils/discord';
import { sendLongMessage } from './utils';

// adminUserId → meetingId (waiting for summary edit DM reply)
const pendingSummaryEdits = new Map<string, string>();

// meetingId → guild member options for StringSelectMenu
interface MemberOption { label: string; description: string; value: string }
const memberOptionsCache = new Map<string, MemberOption[]>();

// ── Task card builder ─────────────────────────────────────────────────────────

function buildTaskCard(
  taskId: string,
  title: string,
  description: string | undefined,
  suggestedName: string,
  state: 'pending' | 'assigned' | 'skipped',
  memberOptions: MemberOption[],
  assignedDiscordId?: string,
) {
  const assignedValue =
    state === 'assigned' && assignedDiscordId
      ? `<@${assignedDiscordId}>`
      : state === 'skipped'
      ? '⏭️ Skipped'
      : '— not yet assigned —';

  const embed = new EmbedBuilder()
    .setTitle('📌 Task Assignment')
    .addFields(
      { name: 'Title', value: title },
      { name: 'Description', value: description || '—' },
      { name: 'AI Suggested', value: suggestedName, inline: true },
      { name: 'Assigned To', value: assignedValue, inline: true },
    )
    .setColor(state === 'assigned' ? 0x57f287 : state === 'skipped' ? 0x95a5a6 : 0x5865f2);

  const displayOptions = memberOptions.length > 0 ? memberOptions : [{ label: 'No members found', description: '', value: 'none' }];
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`assigntask_${taskId}`)
    .setPlaceholder('Select member to assign')
    .setDisabled(state !== 'pending')
    .addOptions(displayOptions.map((o) =>
      new StringSelectMenuOptionBuilder().setLabel(o.label).setDescription(o.description).setValue(o.value),
    ));

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`edittask_${taskId}`)
      .setLabel('✏️ Edit Task')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state === 'skipped'),
    new ButtonBuilder()
      .setCustomId(`skiptask_${taskId}`)
      .setLabel('⏭️ Skip')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(state === 'skipped'),
  );

  return { embeds: [embed], components: [selectRow, btnRow] };
}

// ── Start workflow ────────────────────────────────────────────────────────────

export async function startApprovalWorkflow(
  meetingId: string,
  cfg: IGuildConfig,
  summary: string,
): Promise<void> {
  let adminUser;
  try {
    adminUser = await client.users.fetch(cfg.adminUserId);
  } catch {
    console.error(`[approval] Could not fetch admin ${cfg.adminUserId}`);
    return;
  }

  const tasks = await Task.find({ meetingId }).lean();
  const dm = await adminUser.createDM();

  // Fetch all guild members and cache options for select menus
  const guild = client.guilds.cache.get(cfg.guildId);
  try { await guild?.members.fetch(); } catch { /* large guild, use cache */ }
  const memberOptions: MemberOption[] = (guild?.members.cache
    .filter((m) => !m.user.bot)
    .map((m) => ({
      label: m.displayName.slice(0, 100),
      description: `@${m.user.username}`.slice(0, 100),
      value: m.id,
    }))
    .slice(0, 25)) ?? [];
  memberOptionsCache.set(meetingId, memberOptions);

  // Summary card
  const summaryEmbed = new EmbedBuilder()
    .setTitle('📋 Meeting Summary')
    .setDescription(summary.slice(0, 4096))
    .setColor(0x5865f2);

  const summaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`editsummary_${meetingId}`)
      .setLabel('✏️ Edit Summary')
      .setStyle(ButtonStyle.Secondary),
  );

  await dm.send({ embeds: [summaryEmbed], components: [summaryRow] });

  // One task card per task
  for (const task of tasks) {
    await dm.send(buildTaskCard(task._id.toString(), task.title, task.description, task.assignedTo, 'pending', memberOptions));
  }

  // Dispatch button
  const dispatchRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dispatchtasks_${meetingId}`)
      .setLabel('🚀 Dispatch Assigned Tasks')
      .setStyle(ButtonStyle.Primary),
  );
  await dm.send({
    content: tasks.length
      ? '📬 Assign members above, then click to dispatch when ready.'
      : '📬 No tasks extracted. Click to post summary and finalize.',
    components: [dispatchRow],
  });

  await ApprovalRequest.create({
    meetingId,
    adminUserId: cfg.adminUserId,
    adminMessageId: '—',
    originalSummary: summary,
    status: 'pending',
    sentToAdminAt: new Date(),
  });

  const textChannel = await getTextChannel(cfg.textChannelId);
  await textChannel.send('📬 Meeting summary sent to admin for task assignment.');
  console.log(`[approval] Workflow started for meeting ${meetingId}`);
}

// ── StringSelectMenu: assign task ────────────────────────────────────────────

export async function handleTaskAssignSelect(
  interaction: StringSelectMenuInteraction,
  taskId: string,
): Promise<void> {
  await interaction.deferUpdate();

  const discordUserId = interaction.values[0];
  if (discordUserId === 'none') return;

  const task = await Task.findById(taskId).lean();
  if (!task) return;

  const meeting = await Meeting.findById(task.meetingId).lean();
  if (!meeting) return;

  const guild = client.guilds.cache.get(meeting.guildId);
  const member = guild?.members.cache.get(discordUserId);
  const displayName = member?.displayName ?? discordUserId;

  await Task.findByIdAndUpdate(taskId, {
    assignedDiscordId: discordUserId,
    assignedTo: displayName,
    approvedByAdmin: true,
  });

  const memberOptions = memberOptionsCache.get(meeting._id.toString()) ?? [];
  await interaction.editReply(
    buildTaskCard(taskId, task.title, task.description, task.assignedTo, 'assigned', memberOptions, discordUserId),
  );
}

// ── Button: Edit Task (shows modal) ──────────────────────────────────────────

export async function handleEditTaskButton(
  interaction: ButtonInteraction,
  taskId: string,
): Promise<void> {
  const task = await Task.findById(taskId).lean();
  if (!task) {
    await interaction.reply({ content: 'Task not found.', ephemeral: false });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`taskmodal_${taskId}`)
    .setTitle('Edit Task');

  const titleInput = new TextInputBuilder()
    .setCustomId('taskTitle')
    .setLabel('Title')
    .setStyle(TextInputStyle.Short)
    .setValue(task.title)
    .setRequired(true);

  const descInput = new TextInputBuilder()
    .setCustomId('taskDescription')
    .setLabel('Description (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(task.description ?? '')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
  );

  await interaction.showModal(modal);
}

// ── Modal submit: task edit ───────────────────────────────────────────────────

export async function handleTaskModalSubmit(
  interaction: ModalSubmitInteraction,
  taskId: string,
): Promise<void> {
  await interaction.deferUpdate();

  const newTitle = interaction.fields.getTextInputValue('taskTitle').trim();
  const newDescription = interaction.fields.getTextInputValue('taskDescription').trim() || undefined;

  await Task.findByIdAndUpdate(taskId, { title: newTitle, description: newDescription });

  const task = await Task.findById(taskId).lean();
  if (!task) return;

  const meetingId = task.meetingId.toString();
  const memberOptions = memberOptionsCache.get(meetingId) ?? [];
  const state = task.assignedDiscordId ? 'assigned' : 'pending';
  await interaction.editReply(
    buildTaskCard(taskId, task.title, task.description, task.assignedTo, state, memberOptions, task.assignedDiscordId),
  );
}

// ── Button: Skip Task ─────────────────────────────────────────────────────────

export async function handleSkipTaskButton(
  interaction: ButtonInteraction,
  taskId: string,
): Promise<void> {
  await interaction.deferUpdate();

  const task = await Task.findById(taskId).lean();
  if (!task) return;

  const memberOptions = memberOptionsCache.get(task.meetingId.toString()) ?? [];
  await interaction.editReply(
    buildTaskCard(taskId, task.title, task.description, task.assignedTo, 'skipped', memberOptions),
  );
}

// ── Button: Edit Summary ──────────────────────────────────────────────────────

export async function handleEditSummaryButton(
  interaction: ButtonInteraction,
  meetingId: string,
): Promise<void> {
  pendingSummaryEdits.set(interaction.user.id, meetingId);
  await interaction.reply('✏️ Send your edited summary as the next message in this DM.');
}

// ── Button: Dispatch Tasks ────────────────────────────────────────────────────

export async function handleDispatchButton(
  interaction: ButtonInteraction,
  meetingId: string,
): Promise<void> {
  await interaction.deferUpdate();

  const meeting = await Meeting.findById(meetingId).lean();
  if (!meeting) return;

  const cfg = await GuildConfig.findOne({ guildId: meeting.guildId, isActive: true }).lean();
  if (!cfg) return;

  const approval = await ApprovalRequest.findOne({ meetingId, status: 'pending' });
  if (!approval) {
    await interaction.followUp({ content: 'Already dispatched or not found.' });
    return;
  }

  await ApprovalRequest.findByIdAndUpdate(approval._id, {
    status: 'approved',
    approvedAt: new Date(),
  });

  const textChannel = await getTextChannel(cfg.textChannelId);
  await sendLongMessage(textChannel, approval.editedSummary ?? approval.originalSummary, '📋 **Summary**\n');

  await dispatchTasksToAssignees(meetingId, cfg);
  await textChannel.send('✅ Meeting ended.');

  await interaction.editReply({ content: '✅ Tasks dispatched.', components: [] });
  console.log(`[approval] Meeting ${meetingId} dispatched`);
}

// ── DM message handler (summary edit reply) ───────────────────────────────────

export async function handleAdminDmMessage(message: Message): Promise<void> {
  const meetingId = pendingSummaryEdits.get(message.author.id);
  if (!meetingId) return;

  pendingSummaryEdits.delete(message.author.id);
  await ApprovalRequest.findOneAndUpdate(
    { meetingId, adminUserId: message.author.id },
    { editedSummary: message.content },
  );
  await message.reply('✅ Summary updated. Use the Dispatch button when ready.');
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function dispatchTasksToAssignees(meetingId: string, cfg: IGuildConfig): Promise<void> {
  const tasks = await Task.find({ meetingId, assignedDiscordId: { $exists: true, $ne: null } }).lean();
  if (!tasks.length) return;

  const guild = client.guilds.cache.get(cfg.guildId);
  try { await guild?.members.fetch(); } catch { /* large guild */ }

  const textChannel = await getTextChannel(cfg.textChannelId);

  for (const task of tasks) {
    const taskMsg =
      `📌 **Task assigned to you:**\n**${task.title}**` +
      `${task.description ? `\n${task.description}` : ''}`;

    try {
      const member =
        guild?.members.cache.get(task.assignedDiscordId!) ??
        (await guild?.members.fetch(task.assignedDiscordId!));

      if (member) {
        try {
          await member.send(taskMsg);
        } catch {
          await textChannel.send(`<@${task.assignedDiscordId}> ${taskMsg}`);
        }
      } else {
        await textChannel.send(`<@${task.assignedDiscordId}> ${taskMsg}`);
      }

      await Task.findByIdAndUpdate(task._id, { dispatchedAt: new Date() });
    } catch (err) {
      console.error(`[approval] Dispatch error for task ${task._id}: ${err}`);
    }
  }
}
