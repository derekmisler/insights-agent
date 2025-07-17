// server.ts
import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { streamClaudeResponse } from './src/server/claude-handler.js';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/api/claude', async (req, res) => {
  const { prompt } = req.body;

  try {
    const response = await streamClaudeResponse(prompt);

    // Convert Web Response to Node.js stream
    if (response.body) {
      res.setHeader('Content-Type', 'text/plain');
      res.writeHead(200);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }

      res.end();
    } else {
      res.status(500).send('Claude returned no body');
    }
  } catch (err) {
    console.error('[Claude Error]', err);
    res.status(500).send('Internal Server Error');
  }
});

(async () => {
  const vite = await createViteServer({
    server: { middlewareMode: true },
  });

  app.use(vite.middlewares);

  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
})();