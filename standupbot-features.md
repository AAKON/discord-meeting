# StandupBot — Finalized Product Features (v2)

---

## 1. Tenant Registration

- `/setup` command for Discord server admins
- Configure voice channel, text channel, timezone
- Bot validates channel permissions on setup
- One config per guild, stored in DB

---

## 2. Meeting Scheduling

- **Immediate** — `/start-meeting` starts right now
- **One-off** — `/schedule-meeting [date] [time] [title]` runs once at that datetime
- **Recurring** — daily cron at configured time (existing)
- `/end-meeting` stops any active meeting manually

---

## 3. Participant Management

- `/create-meeting` accepts optional participant list (Discord @mentions)
- Bot pings listed participants when meeting starts
- Participants not in voice after 5 minutes → marked absent
- Late joiners and early leavers tracked with timestamps

---

## 4. Transcription & AI Processing

- Per-speaker transcription using Deepgram Nova-2
- Multilingual support (English, Bangla, mixed)
- AI generates structured summary after meeting ends:
  - Key points
  - Decisions made
  - Action items with assignees

---

## 5. Admin Approval Workflow

- After meeting ends → bot sends summary + task list privately to the Discord server admin
- Admin gets two options via Discord buttons:
  - **Approve** → tasks dispatched as-is
  - **Edit then Approve** → admin edits in a follow-up message, then confirms
- Once approved → each assignee receives a DM from the bot with their tasks
- Tasks without a matched Discord user → posted to the meeting text channel instead

---

## 6. Task Management

- AI auto-extracts tasks from transcript
- `/assign-task [@user] [task]` for manual assignment during meeting
- `/show-tasks` shows all tasks from latest meeting grouped by assignee
- Task status: `pending` → `done`
- `/task-done [task-id]` for assignees to mark their task complete

---

## 7. Meeting History

- `/meeting-history` lists last 10 meetings (title, date, participant count, status)
- `/meeting-summary [meeting-id]` shows full transcript + summary of a specific meeting
- `/attendance [meeting-id]` shows who attended, who was absent

---

## 8. Slash Commands — Full List

| Command | Description |
|---|---|
| `/setup` | Initial bot configuration for the server |
| `/config show` | Display current server config |
| `/schedule-meeting` | Create a one-off scheduled meeting |
| `/start-meeting` | Start a meeting immediately |
| `/end-meeting` | End active meeting |
| `/assign-task` | Manually assign a task during meeting |
| `/show-tasks` | Show tasks from latest meeting |
| `/task-done` | Mark a task as complete |
| `/meeting-history` | List past 10 meetings |
| `/meeting-summary` | View transcript + summary of a specific meeting |
| `/attendance` | View attendance of a specific meeting |

---

## 9. Data Models

| Model | Key Fields |
|---|---|
| `GuildConfig` | guildId, voiceChannelId, textChannelId, timezone, adminUserId |
| `Meeting` | guildId, title, type (immediate / oneoff / recurring), scheduledTime, startTime, endTime, status, participants[] |
| `TranscriptEntry` | meetingId, discordUserId, displayName, text, timestamp |
| `Task` | meetingId, assignedTo, title, status, approvedByAdmin |
| `ApprovalRequest` | meetingId, sentToAdminAt, status (pending / approved), editedSummary |

---

## 10. Out of Scope (v2)

The following are explicitly deferred and will not be built in this version:

- Web dashboard
- Stripe / billing / tier gating
- Notion, Slack, or any third-party integrations
- Speaking time analytics
- Multi-language summary output
