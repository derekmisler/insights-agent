import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { streamClaudeResponse } from './src/server/claude-handler';

dotenv.config();
const app = express();

app.use(express.json());

app.post('/api/claude', async (req, res) => {
  const { prompt } = req.body;
  const result = await streamClaudeResponse(prompt, res);
  result.body?.pipe(res);
});

(async () => {
  const vite = await createViteServer({ server: { middlewareMode: true } });
  app.use(vite.middlewares);

  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`→ Server running at http://localhost:${PORT}`);
  });
})();