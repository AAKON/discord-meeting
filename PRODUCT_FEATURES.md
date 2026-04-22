# StandupBot — Product Features

## What It Is

A Discord bot that automatically joins voice channels, records standups, transcribes per speaker, extracts action items with AI, and posts everything to a text channel. Zero friction — no Zoom links, no manual note-taking.

---

## Current State (v1.0 — Built)

### Voice Recording
- Joins voice channel at scheduled time
- Captures each speaker's audio as a separate stream
- Chunks audio every 15 seconds per speaker
- Converts Opus → 16kHz mono WAV (Whisper-compatible)
- Cleans up audio files after transcription

### Transcription
- Deepgram Nova-2 STT (primary)
- Per-speaker labeled output (uses Discord display names)
- Async queue via BullMQ + Redis (5 concurrent workers)
- Retry on failure (up to 3 attempts)
- Multilingual: English, Bangla, mixed

### Scheduling
- Daily cron schedule (configurable time + timezone)
- Configurable meeting duration
- Pre-meeting reminder posted to text channel
- Auto-start and auto-end

### Participant Tracking
- Detects who was in channel at start
- Detects late joiners → posts notification
- Detects early leavers → posts notification + flushes their audio
- Tracks join/leave timestamps per participant
- Displays meeting duration at end

### AI Features
- **AI Summary** (Groq Llama 3.3 70B): key points, decisions, action items
- **AI Task Extraction**: automatically parses task assignments from conversation
- Handles multilingual conversations, responds in English

### Task Management
- AI auto-extracts tasks from transcript after meeting
- `/assign-task` command assigns tasks manually during meeting
- Tasks stored per meeting, grouped by assignee
- `/show-tasks` displays tasks from latest meeting

### Slash Commands
| Command | Description |
|---|---|
| `/create-meeting` | Schedule a meeting with title + time |
| `/start-meeting` | Manually start recording now |
| `/end-meeting` | Manually stop recording + post transcript |
| `/meeting-summary` | Re-post latest meeting transcript |
| `/attendance` | List speakers from last meeting |
| `/assign-task` | Assign a task to someone during meeting |
| `/show-tasks` | Show all tasks from latest meeting |

### Data Storage
- MongoDB: meetings, transcript entries, tasks, participants
- Meeting status: scheduled → active → completed / cancelled
- Full transcript stored per chunk, sorted by timestamp on retrieval

---

## Phase 2 — Multi-tenant (Required for Product)

> Current bot is single-guild (one Discord server). This phase makes it work for any server.

### Guild Configuration
- Remove hardcoded guild/channel IDs from `.env`
- `GuildConfig` model in DB: voiceChannelId, textChannelId, meetingTime, duration, reminderMinutes, timezone, tier
- `/setup` command for server admins to configure the bot
- `/config show` to display current settings
- Validate that configured channels exist and bot has permissions before saving

### Global Command Registration
- Register slash commands globally (not per-guild)
- Scope all DB reads/writes to `guildId`
- Handle `guildCreate` / `guildDelete` events (create/archive config)

### Per-guild Scheduler
- Each guild runs its own cron schedule from DB config
- Dynamically start/stop schedules when config changes
- Handle timezone per guild

---

## Phase 3 — Web Dashboard

> Guild admins manage settings and browse history without using Discord commands.

### Authentication
- Discord OAuth2 login
- Only show guilds where user has `MANAGE_GUILD` permission
- Session management (JWT or cookie)

### Guild Settings Page
- Pick voice channel + text channel from dropdowns (fetched via Discord API)
- Set meeting time, duration, reminder offset, timezone
- Save → updates DB + restarts that guild's cron

### Meeting History
- List all past meetings for the guild
- Click into a meeting → see full transcript
- Search transcript by keyword or speaker name
- Display duration, participant count, attendance

### Task Dashboard
- All tasks from all meetings for the guild
- Filter by assignee, status, meeting
- Mark tasks complete (updates DB)

### Usage Dashboard (for billing)
- Meetings used this month
- Minutes transcribed
- Current plan + upgrade button

---

## Phase 4 — Tiers & Monetization

### Free Tier
- 5 meetings/month
- 30 min max per meeting
- Basic transcript (per-speaker text)
- 1 Discord server
- 7-day transcript history

### Pro Tier (~$12/month per server)
- Unlimited meetings
- 2-hour max per meeting
- AI summary + task extraction
- Full meeting history (forever)
- Web dashboard access
- Export transcript as TXT / Markdown
- Unlimited servers (billed per server)

### Team Tier (~$29/month per server) *(future)*
- Everything in Pro
- Notion integration (auto-push transcript + tasks)
- Slack integration (post summary to Slack channel)
- Custom meeting reminder messages
- Priority support

### Gating Logic
- `tier` field on `GuildConfig`: `free | pro | team`
- Check tier at job processing time (AI features) and meeting start (duration limits)
- Stripe Checkout for upgrades
- Stripe webhooks flip tier in DB on payment/cancellation
- Over-limit message posted to text channel with upgrade link

---

## Phase 5 — AI Feature Upgrades

### Better Summaries
- Structured output: decisions, blockers, action items as separate sections
- Include speaker attribution in summary ("Alice decided to...", "Bob will handle...")
- Configurable summary language (respond in same language as meeting)

### Smart Task Detection
- Link extracted tasks to Discord usernames when name matches
- Detect due dates mentioned in conversation ("by Friday", "next week")
- Task status updates via `/task-done [task-id]` command

### Meeting Insights *(Pro+)*
- Speak time per participant (% of meeting)
- Topic segments (what was discussed, and when)
- Recurring topic tracking across meetings ("redis issues came up again")

### Ask Your Meeting *(Pro+)*
- `/ask [question]` queries transcript with AI
- Example: "What did we decide about the API deadline?"

---

## Phase 6 — Integrations *(Team Tier)*

| Integration | What it does |
|---|---|
| **Notion** | Creates a Notion page per meeting with transcript, summary, tasks |
| **Slack** | Posts summary + task list to a Slack channel after meeting ends |
| **Google Calendar** | Creates calendar event for next scheduled meeting |
| **Trello / Linear** *(future)* | Creates cards/issues from extracted tasks |

---

## Phase 7 — Distribution & Growth

### Bot Discovery
- List on top.gg, discordbotlist.com, discord.bots.gg
- Bot description optimized for "standup", "meeting", "transcription" search terms
- Vote reminders (top.gg voting boosts ranking)

### Landing Page
- Headline: "Your Discord standup, automatically recorded and summarized"
- "Add to Discord" CTA
- Demo GIF showing transcript + summary output
- Pricing table (Free / Pro / Team)
- FAQ

### Discord Support Server
- #announcements, #help, #feedback channels
- Bot posts release notes to #announcements

---

## Tech Stack (Current + Planned)

| Layer | Current | Planned Addition |
|---|---|---|
| Bot | discord.js | — |
| Voice | @discordjs/voice | — |
| STT | Deepgram Nova-2 | — |
| AI | Groq Llama 3.3 70B | — |
| Queue | BullMQ + Redis | Upstash (managed) |
| DB | MongoDB + Mongoose | MongoDB Atlas |
| Scheduler | node-cron | Per-guild dynamic scheduler |
| Dashboard | — | Next.js + Tailwind |
| Auth | — | Discord OAuth2 |
| Payments | — | Stripe |
| Hosting | Self-hosted | Railway (bot) + Vercel (dashboard) |

---

## Data Models Summary

| Model | Key Fields |
|---|---|
| `GuildConfig` | guildId, voiceChannelId, textChannelId, meetingTime, timezone, tier, stripeCustomerId |
| `Meeting` | guildId, title, scheduledTime, startTime, endTime, status, participants[] |
| `TranscriptEntry` | meetingId, discordUserId, displayName, text, startTimestamp, chunkIndex |
| `Task` | meetingId, assignedTo, title, description, dueDate, status |
| `Subscription` | guildId, stripeSubscriptionId, tier, currentPeriodEnd |

---

## Build Order

| Phase | What | Priority |
|---|---|---|
| 1 | Multi-tenant core (GuildConfig, /setup, global commands) | **Must ship first** |
| 2 | Hosting (Railway + Upstash + Atlas) | **Must ship first** |
| 3 | Landing page + "Add to Discord" | Before any marketing |
| 4 | Stripe billing + tier gating | Before charging anyone |
| 5 | Web dashboard | After first paying customers |
| 6 | AI upgrades | After dashboard |
| 7 | Integrations | After Pro tier has traction |