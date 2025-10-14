import fetch from 'node-fetch';
import fs from 'fs';
import dayjs from 'dayjs';
import { Octokit } from '@octokit/rest';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export async function runSync() {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const refreshToken = process.env.REFRESH_TOKEN;
  const ghToken = process.env.GH_TOKEN;
  const ghRepo = process.env.GH_REPO;
  const ghBranch = process.env.GH_BRANCH || 'main';

  const today = dayjs().tz('Europe/Budapest').format('YYYY-MM-DD');
  
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
    const localPlayedAt = dayjs(item.played_at).tz('Europe/Budapest');
    const localDate = localPlayedAt.format('YYYY-MM-DD');

    return (
      localDate === today &&
      (!lastSynced || localPlayedAt.isAfter(dayjs.tz(lastSynced, 'Europe/Budapest')))
    );
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
  const newestPlayed = newTracks
    .map(item => dayjs(item.played_at).tz('Europe/Budapest'))
    .sort()
    .slice(-1)[0];

  const updatedFrontmatter = `---\ndate: ${today}\nsource: spotify\ntype: listening-history\nlastSynced: ${newestPlayed.format()}\n---\n\n`;

  // Step 6: Merge and save locally
  const headerlessContent = existingContent.replace(/^---[\s\S]*?---\n*/, '');
  const finalContent = updatedFrontmatter + `## 🎧 Spotify Listening History – ${today}\n\n` + headerlessContent + newEntries;

  if (!fs.existsSync('spotify-history')) fs.mkdirSync('spotify-history');
  fs.writeFileSync(filePath, finalContent);
  console.log('✅ Markdown file updated locally!');

  // Step 7: Push to GitHub
  const octokit = new Octokit({ auth: ghToken });
  const [owner, repo] = ghRepo.split('/');
  let sha = null;

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: ghBranch,
    });
    sha = data.sha;
  } catch (err) {
    console.log('📁 GitHub file does not exist yet — will create new one.');
  }

  const encoded = Buffer.from(finalContent).toString('base64');
  const commitMessage = `Update listening history for ${today}`;

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: commitMessage,
    content: encoded,
    branch: ghBranch,
    sha: sha || undefined,
  });

  console.log('🚀 File successfully pushed to GitHub!');
}
