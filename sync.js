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

    if (localDate !== today) return false;

    if (!lastSynced) return true;

    const last = dayjs.tz(lastSynced, 'Europe/Budapest');
    console.log(`🎧 ${item.track.name} | UTC: ${item.played_at} | Local: ${localPlayedAt.format()} | Date: ${localDate} | Included: ${localDate === today && (!lastSynced || localPlayedAt.isAfter(last))}`);
    return localPlayedAt.isAfter(last);
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
      const time = dayjs(sorted[0]).tz('Europe/Budapest').format('HH:mm');
      newEntries += `- *“${name}”* by ${artists}  \n  ⏱️ Played 1 time at ${time}\n`;
    } else {
      const start = dayjs(sorted[0]).tz('Europe/Budapest').format('HH:mm');
      const end = dayjs(sorted[sorted.length - 1]).tz('Europe/Budapest').format('HH:mm');
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

  // Extract existing track signatures
  const existingSignatures = new Set();
  const entryRegex = /- \*“(.*?)”\* by (.*?)\s+⏱️ Played (\d+) time(?:s)?(?: between (\d{2}:\d{2}) and (\d{2}:\d{2})| at (\d{2}:\d{2}))/g;
  let match;
  while ((match = entryRegex.exec(headerlessContent)) !== null) {
    const [_, name, artists, count, start, end, time] = match;
    const signature = `${name}__${artists}__${count}__${start || time}__${end || ''}`;
    existingSignatures.add(signature);
  }

  // Filter out duplicates
  let deduplicatedEntries = '';
  for (const key in grouped) {
    const { name, artists, plays } = grouped[key];
    const sorted = plays.sort();
    const count = plays.length;

    const start = dayjs(sorted[0]).tz('Europe/Budapest').format('HH:mm');
    const end = count > 1 ? dayjs(sorted[sorted.length - 1]).tz('Europe/Budapest').format('HH:mm') : '';
    const signature = `${name}__${artists}__${count}__${start}__${end}`;

    if (existingSignatures.has(signature)) continue;

    if (count === 1) {
      deduplicatedEntries += `- *“${name}”* by ${artists}  \n  ⏱️ Played 1 time at ${start}\n`;
    } else {
      deduplicatedEntries += `- *“${name}”* by ${artists}  \n  ⏱️ Played ${count} times between ${start} and ${end}\n`;
    }
  }

  // Only add header if not present
  const header = `## 🎧 Spotify Listening History – ${today}\n\n`;
  const hasHeader = headerlessContent.includes(header.trim());
  const finalContent = updatedFrontmatter + (hasHeader ? '' : header) + headerlessContent + deduplicatedEntries;



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
    if (err.status === 404) {
      console.log('📁 GitHub file does not exist yet — will create new one.');
    } else {
      console.error(`❌ Failed to fetch file metadata: ${err.message}`);
      return;
    }
  }

  const encoded = Buffer.from(finalContent).toString('base64');
  const commitMessage = `Update listening history for ${today}`;

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: commitMessage,
      content: encoded,
      branch: ghBranch,
      sha: sha || undefined,
    });
    console.log(`🚀 File successfully pushed to GitHub: ${filePath}`);
  } catch (err) {
    if (err.status === 409) {
      console.warn(`⚠️ SHA conflict detected. Retrying with latest SHA...`);
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: ghBranch,
        });
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: filePath,
          message: commitMessage,
          content: encoded,
          branch: ghBranch,
          sha: data.sha,
        });
        console.log(`✅ Retry successful: ${filePath}`);
      } catch (retryErr) {
        console.error(`❌ Retry failed: ${retryErr.message}`);
      }
    } else {
      console.error(`❌ GitHub push failed: ${err.message}`);
    }
  }} 
