import fetch from 'node-fetch';
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

  const octokit = new Octokit({ auth: ghToken });
  const [owner, repo] = ghRepo.split('/');
  let existingContent = '';
  let lastSynced = null;
  let sha = null;

  // Step 0: Load existing file from GitHub
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: ghBranch,
    });

    if (data.type === 'file') {
      existingContent = Buffer.from(data.content, 'base64').toString('utf-8');
      sha = data.sha;

      const match = existingContent.match(/lastSynced:\s*(.+)/);
      if (match) lastSynced = match[1].trim();
    }
  } catch (err) {
    if (err.status === 404) {
      console.log('📁 GitHub file does not exist yet — will create new one.');
    } else {
      console.error(`❌ Failed to fetch file from GitHub: ${err.message}`);
      return;
    }
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
    return localPlayedAt.isAfter(last);
  });

  if (newTracks.length === 0) {
    console.log('✅ No new tracks to sync.');
    return;
  }

  // Step 3: Extract existing play signatures
  const frontmatterMatch = existingContent.match(/^---[\s\S]*?---/);
  const body = existingContent.replace(/^---[\s\S]*?---\n*/, '');

  const existingSignatures = new Set();
  const entryRegex = /- \*“(.*?)”\* by (.*?)\s+⏱️ Played at (\d{2}:\d{2})/g;
  let match;
  while ((match = entryRegex.exec(body)) !== null) {
    const [_, name, artists, time] = match;
    const signature = `${name}__${artists}__${time}`;
    existingSignatures.add(signature);
  }

  // Step 4: Format new Markdown entries
  let deduplicatedEntries = '';
  for (const item of newTracks) {
    const track = item.track;
    const name = track.name;
    const artists = track.artists.map(a => a.name).join(', ');
    const localTime = dayjs(item.played_at).tz('Europe/Budapest').format('HH:mm');
    const signature = `${name}__${artists}__${localTime}`;

    if (existingSignatures.has(signature)) continue;

    deduplicatedEntries += `- *“${name}”* by ${artists}  \n  ⏱️ Played at ${localTime}\n`;
  }

  // Step 5: Update lastSynced
  const newestPlayed = newTracks
    .map(item => dayjs(item.played_at).tz('Europe/Budapest'))
    .sort()
    .slice(-1)[0];

  const updatedFrontmatter = frontmatterMatch
    ? frontmatterMatch[0].replace(/lastSynced:\s*.+/, `lastSynced: ${newestPlayed.format()}`)
    : `---\ndate: ${today}\nsource: spotify\ntype: listening-history\nlastSynced: ${newestPlayed.format()}\n---`;

  const finalContent = updatedFrontmatter + '\n\n' + body + deduplicatedEntries;

  // Step 6: Push to GitHub
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
  }
}