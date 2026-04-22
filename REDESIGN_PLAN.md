# StandupBot v2 — Redesign Plan

## Goal

Convert single-tenant bot (env-configured, one Discord server) into a multi-tenant product
that any Discord server can add, configure with `/setup`, and use independently.

---

## What Stays Unchanged

These files need no modification:

| File | Why untouched |
|---|---|
| `src/voice/capture.ts` | Per-user audio capture already guild-agnostic |
| `src/voice/converter.ts` | PCM → WAV conversion, no config coupling |
| `src/voice/deepgram.ts` | Deepgram API call, no guild context |
| `src/transcription/summarize.ts` | Groq summarization, stateless |
| `src/transcription/tasks.ts` | AI task extraction, stateless |
| `src/transcription/worker.ts` | BullMQ worker, no guild coupling |
| `src/queue/index.ts` | Queue setup, infra only |
| `src/bot/utils.ts` | sendLongMessage helper |
| `src/utils/queue.ts` | waitForQueueDrain helper |
| `src/utils/discord.ts` | buildParticipantMap helper |

---

## New Files to Create

| File | Purpose |
|---|---|
| `src/db/models/guildConfig.ts` | Per-guild settings: channels, timezone, adminUserId |
| `src/db/models/approvalRequest.ts` | Tracks admin approval state per meeting |
| `src/bot/guards.ts` | `requireGuildConfig()` — DB lookup, errors with "run /setup first" if missing |
| `src/bot/approval.ts` | Full admin approval workflow: DM admin, handle buttons, DM assignees |

---

## Files to Modify

| File | What changes |
|---|---|
| `src/config/index.ts` | Remove all guild/channel/time env vars — keep infra vars only |
| `src/bot/index.ts` | Add `DirectMessages` + `GuildMessageReactions` intents |
| `src/bot/commands.ts` | Full rewrite — v2 command list, register globally |
| `src/bot/events.ts` | Major rewrite — all handlers read from GuildConfig, new handlers added |
| `src/scheduler/cron.ts` | Full rewrite — per-guild dynamic scheduler |
| `src/db/models/meeting.ts` | Add `type` field |
| `src/db/models/task.ts` | Add `approvedByAdmin` field |
| `src/index.ts` | Remove hardcoded guild refs, add guildCreate handler, fix reconnect |

---

## Data Models (Final State)

### GuildConfig (new)
```ts
{
  guildId: string           // Discord guild ID (unique)
  voiceChannelId: string    // Channel bot joins for meetings
  textChannelId: string     // Channel bot posts transcripts to
  timezone: string          // e.g. "Asia/Dhaka"
  adminUserId: string       // Discord user ID who receives approval DMs
  meetingTime: string       // "HH:MM" — for recurring daily meetings
  meetingDurationMinutes: number
  reminderMinutesBefore: number
  isActive: boolean         // false when bot is kicked from guild
}
```

### ApprovalRequest (new)
```ts
{
  meetingId: ObjectId
  adminUserId: string
  adminMessageId: string    // Discord message ID of the approval DM
  status: 'pending' | 'approved'
  editedSummary?: string    // Set if admin chose Edit then Approve
  sentToAdminAt: Date
  approvedAt?: Date
}
```

### Meeting (updated)
```ts
// Add:
type: 'immediate' | 'oneoff' | 'recurring'
```

### Task (updated)
```ts
// Add:
approvedByAdmin: boolean   // default false, set true after admin approves
```

### TranscriptEntry — unchanged

---

## Config Changes

### Remove from .env / schema
```
DISCORD_GUILD_ID
MEETING_VOICE_CHANNEL_ID
MEETING_TEXT_CHANNEL_ID
MEETING_TIME
MEETING_DURATION_MINUTES
REMINDER_MINUTES_BEFORE
TIMEZONE
```

### Keep
```
DISCORD_TOKEN
DISCORD_CLIENT_ID
MONGODB_URI
REDIS_URL
GROQ_API_KEY
DEEPGRAM_API_KEY
```

Guild-specific config moves entirely to `GuildConfig` in MongoDB.

---

## Slash Commands (v2 Full List)

| Command | Options | Description |
|---|---|---|
| `/setup` | `voice-channel`, `text-channel`, `timezone`, `meeting-time`, `duration`, `reminder` | Initial bot config for server — admin only |
| `/config show` | — | Display current server config |
| `/schedule-meeting` | `title`, `date`, `time`, `participants?` | Create a one-off meeting at a specific datetime |
| `/start-meeting` | — | Start a meeting immediately |
| `/end-meeting` | — | End active meeting manually |
| `/assign-task` | `assigned-to`, `title`, `description?` | Assign task manually during a meeting |
| `/show-tasks` | — | Show tasks from latest meeting |
| `/task-done` | `task-id` | Mark a task as complete |
| `/meeting-history` | — | List last 10 meetings |
| `/meeting-summary` | `meeting-id` | Full transcript + summary of a specific meeting |
| `/attendance` | `meeting-id` | Attendance for a specific meeting |

**Registration**: All commands registered globally via `Routes.applicationCommands()`.
Previous per-guild registration (`Routes.applicationGuildCommands()`) removed.

---

## Build Steps

---

### Step 1 — Data Models

**Create** `src/db/models/guildConfig.ts`
- Fields as above
- Unique index on `guildId`

**Create** `src/db/models/approvalRequest.ts`
- Fields as above
- Index on `meetingId`

**Update** `src/db/models/meeting.ts`
- Add `type: 'immediate' | 'oneoff' | 'recurring'` — required field

**Update** `src/db/models/task.ts`
- Add `approvedByAdmin: boolean` — default `false`

---

### Step 2 — Config Cleanup

**Update** `src/config/index.ts`
- Remove the 7 guild-specific vars from zod schema
- Remove from `.env.example`
- Compile check: `npx tsc --noEmit` — will surface every reference to deleted vars

---

### Step 3 — Guards + Bot Client

**Create** `src/bot/guards.ts`
```ts
// requireGuildConfig(guildId) → returns IGuildConfig or throws
// Error message: "Bot not configured. An admin must run /setup first."
```

**Update** `src/bot/index.ts`
- Add intents: `GatewayIntentBits.DirectMessages`, `GatewayIntentBits.GuildMessageReactions`

---

### Step 4 — Command Registration

**Rewrite** `src/bot/commands.ts`
- Define all 11 v2 slash commands
- Channel options use `.addChannelOption()` with `ChannelType.GuildVoice` / `GuildText` filters
- Register via `Routes.applicationCommands(clientId)` — global, not guild-scoped
- Remove old `DISCORD_GUILD_ID` usage

---

### Step 5 — /setup + guildCreate

**In** `src/bot/events.ts` — add `/setup` handler:
1. Check `interaction.memberPermissions.has('ManageGuild')` — reject if not admin
2. Validate bot has `Connect` + `Speak` in voice channel, `SendMessages` in text channel
3. Upsert `GuildConfig` in DB
4. Call `startGuildScheduler(guildConfig)` to activate their cron
5. Reply: "StandupBot configured. Daily standup at [time] [timezone]."

**In** `src/bot/events.ts` — add `/config show` handler:
- Fetch `GuildConfig` for guild, format and reply

**In** `src/index.ts` — add `guildCreate` handler:
- Bot finds first text channel it can write to
- Posts: "Thanks for adding StandupBot! Have a server admin run `/setup` to get started."

**In** `src/index.ts` — add `guildDelete` handler:
- Set `GuildConfig.isActive = false` — preserve history, stop scheduler

---

### Step 6 — Scheduler Redesign

**Rewrite** `src/scheduler/cron.ts`

```
Internal state:
  activeCrons: Map<guildId, ScheduledTask[]>

Exports:
  startGuildScheduler(config: IGuildConfig): void
    - Parse meetingTime + timezone → UTC cron expression
    - Schedule: reminder cron, start cron, end cron
    - Store in activeCrons map

  stopGuildScheduler(guildId: string): void
    - Destroy all cron tasks for this guild
    - Remove from activeCrons map

  restartGuildScheduler(config: IGuildConfig): void
    - stopGuildScheduler(config.guildId)
    - startGuildScheduler(config)
    - Called by /setup when updating config

  startAllSchedulers(): void
    - GuildConfig.find({ isActive: true })
    - Call startGuildScheduler() for each

One-off meetings (/schedule-meeting):
  scheduleOneOffMeeting(meeting: IMeeting, config: IGuildConfig): void
    - Calculate ms until scheduledTime
    - setTimeout → start meeting flow
    - On start: remove from tracking (fires once)
```

Each cron callback reads `IGuildConfig` for channel IDs — no env vars.

---

### Step 7 — Meeting Start Flow

**Update** `/start-meeting` handler:
- Call `requireGuildConfig(guildId)` — get channels, adminUserId
- Create `Meeting` with `type: 'immediate'`
- Join `config.voiceChannelId`, capture audio
- Post to `config.textChannelId`

**Add** `/schedule-meeting` handler:
- Parse `date` + `time` → Date object, validate it's in the future
- Accept optional `participants` (list of @mentions)
- Create `Meeting` with `type: 'oneoff'`, `status: 'scheduled'`, store participant user IDs
- Call `scheduleOneOffMeeting(meeting, guildConfig)`
- Reply: "Meeting scheduled for [datetime]."

**Participant pinging (on any meeting start)**:
- If `meeting.participants` list exists → post @mentions to text channel: "Standup starting now! @user1 @user2"
- `setTimeout(5 * 60 * 1000)` → after 5 min, check who's in voice channel
- Anyone in invited list not in voice → update participant record `isAbsent: true`
- Post to text channel: "⚠️ Absent: @user1"

---

### Step 8 — Meeting End + AI Pipeline

**Update** `/end-meeting` handler and cron end:
- Stop capture, drain queue (unchanged)
- Run `summarizeMeeting()` + `extractTasksFromMeeting()` (unchanged)
- **Instead of posting to channel** → call `startApprovalWorkflow(meetingId, guildConfig)`

---

### Step 9 — Approval Workflow

**Create** `src/bot/approval.ts`

```
startApprovalWorkflow(meetingId, guildConfig):
  1. Fetch meeting summary + task list from DB
  2. Format message: summary block + tasks grouped by assignee
  3. DM adminUserId with two buttons:
       [✅ Approve]  [✏️ Edit then Approve]
  4. Save ApprovalRequest { meetingId, adminUserId, adminMessageId, status: 'pending' }

dispatchTasksToAssignees(meetingId, guildId):
  1. Fetch all tasks where approvedByAdmin = true for this meeting
  2. For each task:
       a. Search guild members for display name match
       b. If matched → DM user: "📌 Task from today's standup: [title] - [description]"
       c. If no match → post to textChannelId: "📌 Task for [name]: [title]"
  3. Post to textChannelId: "✅ Tasks dispatched."
```

**In** `src/bot/events.ts` — add button interaction handler:
```
interactionCreate → isButton():
  customId: 'approve_[meetingId]'
    → Task.updateMany({ meetingId }, { approvedByAdmin: true })
    → dispatchTasksToAssignees()
    → update interaction: "Tasks approved and dispatched."

  customId: 'edit_[meetingId]'
    → bot replies: "Send your edited summary as the next message."
    → store { guildId, adminUserId, meetingId } in a pending-edit Map
    → next message from that admin in DM channel → treat as edited summary
    → save to ApprovalRequest.editedSummary
    → post edited summary to textChannelId
    → approve + dispatch tasks
```

> **Note**: Button interactions must be acknowledged within 3 seconds.
> Use `interaction.deferUpdate()` immediately, then do async DB work.

---

### Step 10 — Remaining Commands

**`/task-done [task-id]`**
- Fetch task, verify `task.meetingId` belongs to interaction's guild (security check)
- Set `status: 'done'`
- Reply: "Task marked complete."

**`/meeting-history`**
- `Meeting.find({ guildId }).sort({ createdAt: -1 }).limit(10)`
- Format: `#1 | Daily Standup | 2026-04-20 | 5 participants | completed`
- Reply in channel

**`/meeting-summary [meeting-id]`**
- Validate `meeting-id` belongs to this guild
- Fetch `TranscriptEntry[]` sorted by timestamp
- Fetch `ApprovalRequest` for edited summary if exists
- Format and post (reuse `sendLongMessage`)

**`/attendance [meeting-id]`**
- Validate `meeting-id` belongs to this guild
- Fetch `meeting.participants`
- Format: present / late / absent / early-leaver
- Reply

---

### Step 11 — Entry Point + Reconnect

**Update** `src/index.ts`
- Remove all `config.DISCORD_GUILD_ID` / `config.MEETING_VOICE_CHANNEL_ID` refs
- Replace `startScheduler()` with `startAllSchedulers()` in `clientReady`
- Reconnect logic: takes `guildId` → fetches `GuildConfig` from DB → gets `voiceChannelId`
- Add `guildCreate` + `guildDelete` handlers

---

## Build Order Summary

| Step | What | Key output |
|---|---|---|
| 1 | Data models | GuildConfig, ApprovalRequest, updated Meeting + Task |
| 2 | Config cleanup | Env vars stripped, compile errors surface all coupled code |
| 3 | Guards + intents | requireGuildConfig(), correct Discord intents |
| 4 | Command registration | All v2 commands globally registered |
| 5 | /setup + guildCreate | Tenants can now onboard |
| 6 | Scheduler redesign | Per-guild cron, one-off support |
| 7 | Meeting start flow | /start-meeting + /schedule-meeting + participant pinging |
| 8 | Meeting end pipeline | End flow triggers approval instead of direct post |
| 9 | Approval workflow | Admin DM, buttons, task dispatch to assignees |
| 10 | Remaining commands | /task-done, /meeting-history, /meeting-summary, /attendance |
| 11 | Entry point | Wire everything, fix reconnect, guildCreate/Delete |

---

## Risk Notes

| Risk | Mitigation |
|---|---|
| Button interaction 3s deadline | Call `interaction.deferUpdate()` immediately, do DB work after |
| Edit flow state between messages | In-memory Map is fine for single-process; note it resets on restart |
| One-off meeting `setTimeout` lost on restart | On boot, re-query `Meeting.find({ type: 'oneoff', status: 'scheduled', scheduledTime: { $gt: now } })` and reschedule |
| Task name → Discord user matching | Fuzzy match on `displayName` + `username`; no match = post to channel (safe fallback) |
| Global command registration takes up to 1 hour to propagate | Use guild-scoped registration in dev, switch to global for prod |