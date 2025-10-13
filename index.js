import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Spotify Sync is running!');
});

app.get('/callback', (req, res) => {
  const code = req.query.code;
  console.log('Authorization code:', code);
  res.send(`Authorization code received: ${code}`);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
