# Discord Meeting Bot - Troubleshooting Guide

## Connection Timeout Error

**Error:** `ConnectTimeoutError: Connect Timeout Error`

### Root Causes & Solutions

#### 1. **Discord Token Invalid**
- Check `.env` file: `DISCORD_TOKEN` must be valid
- Verify token from Discord Developer Portal
- Token format: Usually starts with `Mz...` or `MTk...`
- Regenerate token if uncertain

#### 2. **Discord API Rate Limited**
- If bot keeps retrying, Discord may throttle connections
- Solution: Restart app after 5-10 minutes
- Check Discord Bot Settings for rate limiting

#### 3. **Network/Firewall Issues**
- Bot cannot reach Discord servers on port 443
- Test with: `Test-NetConnection -ComputerName discord.com -Port 443`
- Check if firewall/proxy is blocking Discord API
- Try from different network if available

#### 4. **Guild/Channel IDs Wrong**
- Verify `.env`:
  - `DISCORD_GUILD_ID` (server ID)
  - `DISCORD_CLIENT_ID` (bot application ID)
  - `MEETING_VOICE_CHANNEL_ID` (voice channel ID)
  - `MEETING_TEXT_CHANNEL_ID` (text channel ID)

#### 5. **Bot Permissions**
- Ensure bot has these permissions:
  - Connect to voice channels
  - Speak in voice channels
  - Send messages in text channels
  - Manage messages (for slash commands)

### Quick Checklist

- [ ] Bot token is valid and in `.env`
- [ ] All 4 Discord IDs are correct in `.env`
- [ ] Network can reach discord.com on port 443
- [ ] Bot has correct permissions in server
- [ ] No rate limiting active
- [ ] Restart after fixing environment variables

### Environment Variables Required

```
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_guild_id
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
GROQ_API_KEY=gsk_...
DEEPGRAM_API_KEY=...
MEETING_VOICE_CHANNEL_ID=123456789
MEETING_TEXT_CHANNEL_ID=987654321
MEETING_TIME=09:30
MEETING_DURATION_MINUTES=30
REMINDER_MINUTES_BEFORE=5
TIMEZONE=Asia/Dhaka
```

### Debug Mode

Run with extra logging:
```bash
DEBUG=discord* npm run dev
```

This will show Discord.js connection details.
