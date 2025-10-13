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

app.listen(3000, () => {
  console.log('Server running on port 3000');
});