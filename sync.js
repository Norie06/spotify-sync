import fetch from 'node-fetch';
import fs from 'fs';
import dayjs from 'dayjs';

export async function runSync() {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const refreshToken = process.env.REFRESH_TOKEN;

  const today = dayjs().format('YYYY-MM-DD');
  const filePath = `spotify-history/${today}.md`;

  // Load existing file and extract lastSynced
  let existingContent = '';
  let lastSynced = null;

  if (fs.existsSync(filePath)) {
    existingContent = fs.readFileSync(filePath, 'utf-8');
    const match = existingContent.match(/lastSynced:\s*(.+)/);
    if (match) lastSynced = match[1].trim();
  }

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
  const newTracks = historyData.items.filter(item => {
    return !lastSynced || item.played_at > lastSynced;
  });

  if (newTracks.length === 0) {
    console.log('✅ No new tracks to sync.');
    return;
  }

  // Step 3: Group repeated plays
  const grouped = {};
  for (const item of newTracks) {
    const track = item.track;
    const key = `${track.name}__${track.artists.map(a => a.name).join(', ')}`;
    if (!grouped[key]) {
      grouped[key] = {
        name: track.name,
        artists: track.artists.map(a => a.name).join(', '),
        plays: [],
      };
    }
    grouped[key].plays.push(item.played_at);
  }

  // Step 4: Format new Markdown entries
  let newEntries = '';
  for (const key in grouped) {
    const { name, artists, plays } = grouped[key];
    const sorted = plays.sort();
    const count = plays.length;

    if (count === 1) {
      const time = dayjs(sorted[0]).format('HH:mm');
      newEntries += `- *“${name}”* by ${artists}  \n  ⏱️ Played 1 time at ${time}\n`;
    } else {
      const start = dayjs(sorted[0]).format('HH:mm');
      const end = dayjs(sorted[sorted.length - 1]).format('HH:mm');
      newEntries += `- *“${name}”* by ${artists}  \n  ⏱️ Played ${count} times between ${start} and ${end}\n`;
    }
  }

  // Step 5: Update lastSynced
  const newestPlayed = newTracks[0].played_at;
  const updatedFrontmatter = `---\ndate: ${today}\nsource: spotify\ntype: listening-history\nlastSynced: ${dayjs(newestPlayed).toISOString()}\n---\n\n`;

  // Step 6: Merge and save
  const headerlessContent = existingContent.replace(/^---[\s\S]*?---\n*/, '');
  const finalContent = updatedFrontmatter + `## 🎧 Spotify Listening History – ${today}\n\n` + headerlessContent + newEntries;

  if (!fs.existsSync('spotify-history')) fs.mkdirSync('spotify-history');
  fs.writeFileSync(filePath, finalContent);
  console.log('✅ Markdown file updated!');
}