# Discord Meeting Bot

Records daily standups in a Discord voice channel, transcribes per speaker via Groq Whisper, and posts the full transcript to a text channel.

## Prerequisites

- Node.js 18+
- Redis (local or Upstash)
- MongoDB Atlas (or local)
- Groq API key — [console.groq.com](https://console.groq.com)
- Discord bot token + application

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd discord-meeting
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | Server (guild) ID |
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection URL (`redis://localhost:6379` or Upstash) |
| `GROQ_API_KEY` | Groq API key |
| `MEETING_VOICE_CHANNEL_ID` | Voice channel ID for meetings |
| `MEETING_TEXT_CHANNEL_ID` | Text channel ID for transcripts |
| `MEETING_TIME` | Daily meeting time in `HH:MM` (24h, server local time) |
| `MEETING_DURATION_MINUTES` | Meeting length in minutes |
| `REMINDER_MINUTES_BEFORE` | How many minutes before to send reminder |

### 3. Invite the bot

In Discord Developer Portal → OAuth2 → URL Generator:
- Scopes: `bot`, `applications.commands`
- Bot permissions: `Connect`, `Speak`, `Send Messages`, `Read Message History`, `View Channels`

Open the generated URL and add the bot to your server.

### 4. Run in dev mode

```bash
npm run dev
```

Slash commands are registered automatically on bot startup.

### 5. Build for production

```bash
npm run build
npm start
```

## Slash commands

| Command | Description |
|---|---|
| `/create-meeting` | Create a scheduled meeting record |
| `/start-meeting` | Manually start recording now |
| `/end-meeting` | Manually stop recording and post transcript |
| `/meeting-summary` | Re-post the latest meeting transcript |
| `/attendance` | List speakers from the last meeting |

## How it works

```
Cron (node-cron)
  → Reminder posted to text channel
  → Bot joins voice channel
  → Per-user Opus audio captured in 15-second chunks
  → Each chunk converted to 16kHz mono WAV (ffmpeg)
  → Job queued in BullMQ (Redis)
  → Worker sends WAV to Groq Whisper large-v3
  → Transcript saved to MongoDB
  → Chunk file deleted
  → Meeting ends → entries merged by timestamp
  → Full transcript posted to text channel
```

## Running tests

Place a WAV audio file at `test/sample.wav`, then:

```bash
# Test Groq transcription directly
npm run test:transcription

# Test BullMQ queue + worker (requires Redis + MongoDB running)
npm run test:queue
```
