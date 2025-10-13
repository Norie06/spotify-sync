import fetch from 'node-fetch';

const clientId = 'be82a26788424fd88da8f3537ea9b4ba';
const clientSecret = '7861533265324e60970577aad39432e3';
const redirectUri = 'https://spotify-sync-zakf.onrender.com/callback';
const code = 'AQAqttLzUekxuxzjMyognWwjuj4R2CgLeuVaxPJARD8b7bp4hDYFAc476oaaB1RNdqJhWny8hJ19PPFwTt7SdjOFhzJintXaB540ZAe1zVTCPx59ozTbxoDMvwuusIxqwoZ7zYV7tsio4qOwcLI4ptlCKLtEBh9FPOgKtddIVVWMAUHb6uRxTBcI8o6LM9bbCk8yzvBB9Yiu6WosMO6OzBZUrUqACCFfLbc-veKs';

const tokenUrl = 'https://accounts.spotify.com/api/token';

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  redirect_uri: redirectUri,
});

const headers = {
  'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
  'Content-Type': 'application/x-www-form-urlencoded',
};

fetch(tokenUrl, {
  method: 'POST',
  headers,
  body,
})
  .then(async res => {
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Raw response:', data);
    console.log('Access Token:', data.access_token);
    console.log('Refresh Token:', data.refresh_token);
  })
  .catch(err => console.error('Token exchange failed:', err));

