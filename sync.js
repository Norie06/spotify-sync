import fetch from 'node-fetch';
import fs from 'fs';
import dayjs from 'dayjs';

const clientId = 'be82a26788424fd88da8f3537ea9b4ba';
const clientSecret = '7861533265324e60970577aad39432e3';
const refreshToken = 'AQCR9tu3wXZRUXVR86UbndKzrMEa9hYmxnaRBgyJFIrOaCUAsCsZUVnUQ055XoaH_0RxXewpCxvc7JVwm_92Ulrt8s-ZFri22EB9j7p-lwxGSzrffCSYZjqtMRNkgOis1Ds';
const redirectUri = 'https://spotify-sync-zakf.onrender.com/callback';

// Step 1: Refresh access token
const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }),
});

const tokenData = await tokenResponse.json();
const accessToken = tokenData.access_token;

// Step 2: Fetch recently played tracks
const historyResponse = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
});

const historyData = await historyResponse.json();

// Step 3: Format as Markdown
const today = dayjs().format('YYYY-MM-DD');
let markdown = `## 🎧 Spotify Listening History – ${today}\n\n`;

for (const item of historyData.items) {
  const time = dayjs(item.played_at).format('HH:mm');
  const track = item.track;
  markdown += `- **${time}** – *“${track.name}”* by ${track.artists.map(a => a.name).join(', ')}\n`;
}

// Step 4: Save to file
fs.writeFileSync(`spotify-${today}.md`, markdown);
console.log('✅ Markdown file created!');