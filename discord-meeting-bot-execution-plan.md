# Discord Meeting Bot — Claude Code Execution Plan

## Pre-requisites
Before starting, make sure you have:
- Node.js 18+
- Redis running locally or Upstash URL
- MongoDB Atlas URI
- Groq API key (free at console.groq.com)
- Discord Bot Token + Application created on Discord Developer Portal

---

## Prompt 1 — Project Scaffold

```
Create a Node.js TypeScript project called "discord-meeting-bot" with the following structure:

src/
  bot/
    index.ts         # Discord client setup
    commands.ts      # Slash command registration
    events.ts        # Discord event handlers
  voice/
    capture.ts       # Per-user voice stream capture
    converter.ts     # Opus to WAV conversion
  transcription/
    groq.ts          # Groq Whisper API integration
    worker.ts        # BullMQ worker for transcription jobs
  scheduler/
    cron.ts          # node-cron meeting scheduler
  db/
    mongoose.ts      # MongoDB connection
    models/
      meeting.ts     # Meeting model
      transcript.ts  # TranscriptEntry model
  queue/
    index.ts         # BullMQ queue setup
  config/
    index.ts         # Env config loader
  index.ts           # App entry point

Install dependencies:
- discord.js
- @discordjs/voice
- @discordjs/opus
- bullmq
- mongoose
- node-cron
- groq-sdk
- ffmpeg-static
- fluent-ffmpeg
- dotenv
- zod

Install dev dependencies:
- typescript
- ts-node
- @types/node
- nodemon

Setup tsconfig.json with strict mode and ESM support.
Setup nodemon.json for ts-node.
Create .env.example with these keys:
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
MONGODB_URI=
REDIS_URL=
GROQ_API_KEY=
MEETING_VOICE_CHANNEL_ID=
MEETING_TEXT_CHANNEL_ID=
MEETING_TIME=17:00
MEETING_DURATION_MINUTES=30
REMINDER_MINUTES_BEFORE=5
```

---

## Prompt 2 — Config + DB + Queue

```
In the discord-meeting-bot project:

1. src/config/index.ts
   - Load all env vars using dotenv + zod validation
   - Export typed config object

2. src/db/mongoose.ts
   - Connect to MongoDB using config.MONGODB_URI
   - Export connectDB function

3. src/db/models/meeting.ts
   - Meeting schema with fields:
     id, title, scheduledTime, startTime, endTime,
     guildId, voiceChannelId, textChannelId, status
     (status enum: scheduled | active | completed | cancelled)

4. src/db/models/transcript.ts
   - TranscriptEntry schema with fields:
     id, meetingId, discordUserId, displayName,
     startTimestamp, endTimestamp, text, chunkIndex

5. src/queue/index.ts
   - Setup BullMQ connection using config.REDIS_URL
   - Export a queue named "transcription-queue"
   - Each job payload: { meetingId, userId, displayName, audioFilePath, chunkIndex, timestamp }
```

---

## Prompt 3 — Groq Transcription

```
In src/transcription/groq.ts:
- Initialize Groq SDK using config.GROQ_API_KEY
- Create a function transcribeAudio(audioFilePath: string): Promise<string>
  - Read the audio file as a stream
  - Send to Groq using groq.audio.transcriptions.create()
  - Use model: "whisper-large-v3"
  - Return the transcript text

In src/transcription/worker.ts:
- Create a BullMQ Worker that listens to "transcription-queue"
- For each job:
  1. Call transcribeAudio(job.data.audioFilePath)
  2. Save result to TranscriptEntry in MongoDB
     (meetingId, userId, displayName, text, timestamps from job data)
  3. Delete the audio chunk file after successful transcription
  4. Log success or failure
- Handle errors with retry (attempts: 3)
```

---

## Prompt 4 — Voice Capture

```
In src/voice/converter.ts:
- Create function convertOpusToWav(inputPath: string, outputPath: string): Promise<void>
  - Use fluent-ffmpeg with ffmpeg-static
  - Convert opus/pcm input to 16kHz mono WAV (required by Whisper)

In src/voice/capture.ts:
- Create function startVoiceCapture(connection: VoiceConnection, meetingId: string)
  - Get the receiver from the voice connection
  - Subscribe to each user's audio stream using receiver.subscribe(userId)
  - For each user stream:
    - Pipe audio to a file: chunks/meetingId_userId_chunkIndex.opus
    - Every 15 seconds, close the current chunk file
    - Convert it to WAV using convertOpusToWav()
    - Add a job to the transcription queue with all metadata
    - Start a new chunk file for that user
    - Continue until meeting ends
- Create function stopVoiceCapture(meetingId: string)
  - Flush and process any remaining audio chunks for all users
  - Enqueue final jobs
```

---

## Prompt 5 — Discord Bot + Commands

```
In src/bot/index.ts:
- Initialize Discord.js Client with necessary intents:
  (Guilds, GuildVoiceStates, GuildMessages, MessageContent)
- Export the client instance

In src/bot/commands.ts:
- Register these slash commands to the guild on startup:
  /create-meeting  → creates a meeting record in DB
  /start-meeting   → manually start meeting early
  /end-meeting     → manually end active meeting
  /meeting-summary → fetch and post latest meeting transcript
  /attendance      → show who joined the last meeting

In src/bot/events.ts:
- Handle interactionCreate event for all slash commands
- /start-meeting:
  1. Create Meeting record in DB with status: active
  2. Bot joins MEETING_VOICE_CHANNEL_ID
  3. Call startVoiceCapture()
  4. Post "Meeting started" message to text channel
- /end-meeting:
  1. Call stopVoiceCapture()
  2. Bot leaves voice channel
  3. Update Meeting status to completed
  4. Wait for remaining transcription jobs to finish
  5. Fetch all TranscriptEntry records for this meeting sorted by timestamp
  6. Format and post full transcript to text channel
- /meeting-summary:
  1. Fetch latest completed meeting
  2. Fetch all its TranscriptEntry records
  3. Format as "DisplayName: text" sorted by timestamp
  4. Post to text channel
```

---

## Prompt 6 — Scheduler

```
In src/scheduler/cron.ts:
- Parse config.MEETING_TIME (format: "HH:MM") into cron expression
- Schedule a job using node-cron:

  1. At REMINDER_MINUTES_BEFORE before meeting time:
     - Post reminder message to MEETING_TEXT_CHANNEL_ID:
       "📅 Daily standup starts in X minutes. Please join the voice channel."

  2. At MEETING_TIME exactly:
     - Create a new Meeting record in DB
     - Bot joins MEETING_VOICE_CHANNEL_ID
     - Call startVoiceCapture()
     - Post "🔴 Meeting started. Recording..." to text channel

  3. At MEETING_TIME + MEETING_DURATION_MINUTES:
     - Call stopVoiceCapture()
     - Bot leaves voice channel
     - Update meeting status to completed
     - Wait 30 seconds for remaining transcription jobs
     - Fetch all transcript entries sorted by timestamp
     - Format and post full transcript to text channel
     - Post "✅ Meeting ended. Transcript posted above."
```

---

## Prompt 7 — Entry Point + Error Handling

```
In src/index.ts:
- Call connectDB()
- Start the transcription worker
- Login Discord bot client
- Start the cron scheduler
- Handle process errors gracefully (uncaughtException, unhandledRejection)
- Log all major lifecycle events

Add global error handling in the transcription worker:
- If Groq API fails → retry up to 3 times with exponential backoff
- If audio file not found → skip and log warning
- If MongoDB save fails → retry once then log error

Add reconnect logic in voice capture:
- If bot disconnects from voice channel unexpectedly during a meeting
  → attempt to rejoin automatically up to 3 times
  → if all fail → post alert to text channel
```

---

## Prompt 8 — Testing + Run

```
In the discord-meeting-bot project:

1. Create a test script src/test/testTranscription.ts:
   - Load a sample WAV file from test/sample.wav
   - Call transcribeAudio() and log the result

2. Create a test script src/test/testQueue.ts:
   - Add a dummy job to the transcription queue
   - Verify the worker picks it up and processes it

3. Add these npm scripts to package.json:
   "dev": "nodemon src/index.ts"
   "build": "tsc"
   "start": "node dist/index.js"
   "test:transcription": "ts-node src/test/testTranscription.ts"
   "test:queue": "ts-node src/test/testQueue.ts"

4. Create a README.md with:
   - Setup instructions
   - How to fill .env
   - How to run in dev mode
   - How to invite the bot to a Discord server
   - How to register slash commands
```

---

## Execution Order

| Step | Prompt | What gets built |
|------|--------|-----------------|
| 1 | Prompt 1 | Project structure + dependencies |
| 2 | Prompt 2 | Config + MongoDB + BullMQ queue |
| 3 | Prompt 3 | Groq Whisper transcription + worker |
| 4 | Prompt 4 | Voice capture + Opus to WAV conversion |
| 5 | Prompt 5 | Discord bot + slash commands |
| 6 | Prompt 6 | Cron scheduler + reminders |
| 7 | Prompt 7 | Entry point + error handling + reconnect |
| 8 | Prompt 8 | Test scripts + README |

> After each prompt, verify the project compiles with `npx tsc --noEmit` before moving to the next.

---

## System Architecture (Phase 1)

```
Cron Trigger (node-cron)
  → Send Reminder (Discord text channel)
  → Bot joins Voice Channel (@discordjs/voice)
  → Per-user Opus audio streams captured separately
  → Every 15 sec → chunk saved as .opus file
  → Converted to 16kHz mono WAV (ffmpeg)
  → Job added to BullMQ transcription queue (Redis)
  → BullMQ Worker picks job
  → Sends WAV to Groq Whisper API
  → Transcript text returned
  → Saved to MongoDB (TranscriptEntry)
  → Audio chunk deleted
  → Meeting ends → all chunks merged by timestamp
  → Full transcript posted to Discord text channel
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Bot framework | discord.js |
| Voice capture | @discordjs/voice |
| Audio conversion | ffmpeg + fluent-ffmpeg |
| STT | Groq Whisper Large V3 |
| Queue | BullMQ + Redis |
| Database | MongoDB + Mongoose |
| Scheduler | node-cron |
| Language | Node.js + TypeScript |

---

## Environment Variables

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
MONGODB_URI=
REDIS_URL=
GROQ_API_KEY=
MEETING_VOICE_CHANNEL_ID=
MEETING_TEXT_CHANNEL_ID=
MEETING_TIME=17:00
MEETING_DURATION_MINUTES=30
REMINDER_MINUTES_BEFORE=5
```
