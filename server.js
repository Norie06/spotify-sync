import express from 'express';
import { runSync } from './sync.js';

const app = express();

app.get('/sync', async (req, res) => {
  try {
    await runSync();
    res.send('✅ Sync complete');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Sync failed');
  }
});

app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
