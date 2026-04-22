# StandupBot — End-to-End Testing Guide

Work through phases in order. Each phase depends on the previous.

---

## Phase 0 — Pre-flight

### 0.1 Clean up old .env vars

These vars are **no longer read** by the app and should be removed from `.env`:

```
DISCORD_GUILD_ID
MEETING_VOICE_CHANNEL_ID
MEETING_TEXT_CHANNEL_ID
MEETING_TIME
MEETING_DURATION_MINUTES
REMINDER_MINUTES_BEFORE
```

Required vars (keep these):

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
MONGODB_URI=
REDIS_URL=
GROQ_API_KEY=
DEEPGRAM_API_KEY=
```

### 0.2 Verify services are running

```bash
# MongoDB — should print the mongo shell prompt
mongosh mongodb://localhost:27017/ --eval "db.runCommand({ ping: 1 })"

# Redis — Upstash is remote, test connection via the app startup
# (if you have redis-cli: redis-cli -u $REDIS_URL ping)
```

### 0.3 Build

```bash
npx tsc --noEmit
```

Expected: **0 errors**.

```bash
npm run build
# or: npx tsc
```

---

## Phase 1 — Bot Startup

```bash
npm run dev
# or: node dist/index.js
```

**Expected console output (in order):**

```
[app] DB connected
[app] Transcription worker started
[app] Bot ready as StandupBot#XXXX
[commands] Global slash commands registered
[app] Schedulers started
```

**Check for problems:**
- `Invalid environment variables` → missing .env var
- `Discord login timeout` → bad DISCORD_TOKEN
- `MongoServerError` → MongoDB not running
- Anything `redis` related → bad REDIS_URL

> Note: global slash commands can take up to **1 hour** to propagate to all servers.
> For instant availability on one server use guild-scoped registration (see Phase 1.1 below).

### 1.1 Force-register commands to one guild instantly (dev shortcut)

In `src/bot/commands.ts`, temporarily change:

```ts
// from:
Routes.applicationCommands(config.DISCORD_CLIENT_ID)
// to:
Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, 'YOUR_GUILD_ID')
```

Restart bot. Commands appear instantly. Revert before production.

---

## Phase 2 — Guild Setup (`/setup`)

In your Discord server, run as a user with **Manage Server** permission:

```
/setup
  voice-channel: #your-voice-channel
  text-channel:  #your-text-channel
  meeting-time:  10:00
  timezone:      Asia/Dhaka
  duration:      2
  reminder:      1
```

**Expected bot reply (ephemeral):**

```
StandupBot configured!
• Voice: #your-voice-channel
• Text: #your-text-channel
• Daily standup: 10:00 (Asia/Dhaka)
• Duration: 2 min | Reminder: 1 min before
```

**Verify in DB:**

```bash
mongosh mongodb://localhost:27017/
use your-db-name    # check MONGODB_URI for db name; default is no name = 'test'
db.guildconfigs.findOne()
```

Expected document: `{ guildId, voiceChannelId, textChannelId, timezone, adminUserId, meetingTime, ... isActive: true }`

### 2.1 Verify config display

```
/config show
```

Expected: same values echoed back as ephemeral message.

### 2.2 Test invalid timezone

```
/setup ... timezone: NotReal/Zone
```

Expected: `Invalid timezone: 'NotReal/Zone'. Use an IANA timezone...`

---

## Phase 3 — Immediate Meeting

**Prerequisite:** Join the configured voice channel yourself.

### 3.1 Start meeting

```
/start-meeting
```

**Expected:**
- Bot joins voice channel
- Text channel: `🔴 Meeting started. Recording...`
- Console: `[runner] Meeting <id> started in guild <guildId>`

### 3.2 Speak for 15–30 seconds

Multiple people speaking = better transcript. Single person is fine for testing.

### 3.3 End meeting

```
/end-meeting
```

**Expected sequence in text channel:**

```
⏱️ Meeting Duration: Xm Ys
📝 Conversation
<name>: <what you said>
...
📬 Summary sent to admin for review. Tasks dispatched after approval.
```

**Expected console:**

```
[runner] Meeting <id> ended, awaiting admin approval
[approval] Workflow started for meeting <id>
```

### 3.4 Admin approval — Approve

Admin (the user who ran `/setup`) receives a **DM** from the bot with:
- Meeting summary
- Task list (if any were extracted)
- ✅ Approve button
- ✏️ Edit then Approve button

Click **✅ Approve**.

**Expected:**
- DM updates to: `✅ Approved. Tasks dispatched.`
- Text channel: summary posted + `✅ Meeting ended.`
- Each assignee receives a task DM (or channel post if DMs disabled)

### 3.5 Admin approval — Edit then Approve

Run another short meeting, then click **✏️ Edit then Approve**.

**Expected bot DM reply:**
```
✏️ Send your edited summary as the next message in this DM.
```

Reply to the DM with your edited summary text.

**Expected:**
- Bot replies: `✅ Summary saved and tasks dispatched.`
- Text channel: your edited summary posted

---

## Phase 4 — Verify DB Records

```bash
mongosh mongodb://localhost:27017/
```

```js
// Check meeting was created
db.meetings.findOne({}, {}, { sort: { createdAt: -1 } })

// Check transcript entries exist
db.transcriptentries.find({ meetingId: ObjectId("<id from above>") }).count()

// Check tasks were extracted
db.tasks.find({ meetingId: ObjectId("<id>") })

// Check approval record
db.approvalrequests.findOne({}, {}, { sort: { createdAt: -1 } })
// status should be "approved", approvedAt should be set
```

---

## Phase 5 — Task Commands

### 5.1 Manual task assignment (during active meeting)

Start a meeting first (`/start-meeting`), then:

```
/assign-task
  assigned-to: Alice
  title: Review PR #42
  description: Focus on auth changes
```

**Expected text channel:**
```
📌 Task Assigned
👤 Alice: Review PR #42
Focus on auth changes
```

### 5.2 Show tasks

End the meeting first, then:

```
/show-tasks
```

**Expected:** List of tasks from latest completed meeting, grouped by assignee.

### 5.3 Mark task done

Get task ID from the DB or from the `/show-tasks` output (bot response doesn't show IDs — get from DB for now):

```bash
db.tasks.findOne({}, {}, { sort: { createdAt: -1 } })
# copy the _id
```

```
/task-done task-id: 6830abc123def456789
```

**Expected (ephemeral):** `✅ Task marked complete: Review PR #42`

---

## Phase 6 — Meeting History & Attendance

### 6.1 Meeting history

```
/meeting-history
```

**Expected:** List of last 10 meetings with status icons, titles, dates, types, and IDs.

### 6.2 Meeting summary (transcript replay)

Copy a meeting ID from `/meeting-history`, then:

```
/meeting-summary meeting-id: <id>
```

**Expected:** Full transcript posted to text channel.

### 6.3 Attendance

```
/attendance meeting-id: <id>
```

**Expected:** Speaker list. If participants were invited via `/schedule-meeting`, also shows late/absent/early-leaver flags.

---

## Phase 7 — One-Off Scheduled Meeting

**Set a time 2–3 minutes from now** to test without waiting.

```
/schedule-meeting
  title: Sync Call
  date: 2026-04-22
  time: 14:35
  participants: @alice @bob
```

**Expected:**
```
📅 Meeting scheduled!
• Title: Sync Call
• Time: Apr 22, 2:35 PM (Asia/Dhaka)
• ID: `6830...`
• Participants: @alice @bob
```

**Wait for the scheduled time.** Bot should:
1. Auto-join voice channel
2. Post `📢 @alice @bob Standup is starting now!`
3. Post `🔴 Meeting started. Recording...`
4. After duration minutes: auto-end, post transcript, DM admin for approval

**After 5 minutes check absent detection** — anyone not in voice should get flagged:
```
❌ Not in voice: @alice
```

---

## Phase 8 — Daily Recurring Cron

Change `/setup` meeting-time to **2 minutes from now** in your timezone:

```
/setup
  ...same channels...
  meeting-time: 14:42
  timezone: Asia/Dhaka
  duration: 1
  reminder: 0
```

**Wait for the time.** Expected sequence:
1. `⏰ Standup in 0 minutes!` (if reminder > 0)
2. Bot joins voice
3. `🔴 Meeting started. Recording...`
4. After 1 minute: auto-ends, posts transcript, DMs admin

---

## Phase 9 — Early Leaver & Late Joiner

### 9.1 Early leaver

1. `/start-meeting`
2. Have a second person join voice
3. That person leaves voice mid-meeting

**Expected text channel:**
```
⚠️ **Username** left the meeting early.
```

### 9.2 Late joiner

1. Start meeting while one person is in voice
2. A second person joins voice after the meeting started

**Expected text channel:**
```
🕐 **Username** joined late.
```

---

## Phase 10 — Multi-Tenant (Second Server)

1. Add the bot to a **second Discord server**
2. On join, bot should send welcome message to a text channel automatically
3. Run `/setup` on the second server with different channels
4. Verify `db.guildconfigs.find()` shows **two documents** with different `guildId`
5. Run `/start-meeting` on server 2 — should work independently
6. Run `/start-meeting` on server 1 simultaneously — both meetings active at once
7. End both independently — no cross-contamination

---

## Phase 11 — Error & Edge Cases

| Scenario | Command | Expected |
|---|---|---|
| No setup yet | `/start-meeting` | `⚠️ StandupBot is not configured for this server. Run /setup first.` |
| Meeting already active | `/start-meeting` (twice) | `A meeting is already active.` |
| End with no active meeting | `/end-meeting` | `No active meeting.` |
| Assign task outside meeting | `/assign-task` | `No active meeting. Start a meeting first.` |
| No speech recorded | Start + immediately end | `No speech recorded.` then `✅ Meeting ended.` (no admin DM) |
| Invalid meeting-id | `/meeting-summary meeting-id: fakeid` | `Meeting not found (or belongs to another server).` |
| Non-admin runs setup | `/setup` (as regular member) | `Only server admins can run /setup.` |

---

## Quick Smoke Test (5 minutes)

Fastest path to verify the whole pipeline works:

```bash
# 1. Start bot
npm run dev

# 2. In Discord — run these in order:
/setup voice-channel:#vc text-channel:#general meeting-time:10:00 timezone:UTC duration:2

/start-meeting
# speak for 10 seconds
/end-meeting
# check DM, click ✅ Approve
/meeting-history
/show-tasks
```

If all 5 steps produce correct output — core pipeline is working.
