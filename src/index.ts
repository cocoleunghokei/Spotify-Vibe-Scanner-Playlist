import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { getLlmMode, getModelName, isLlmConfigured } from './services/llmClient';
import cors from 'cors';
import { spotifyRouter } from './routes/spotify';
import { uploadRouter } from './routes/upload';
import { vibeRouter } from './routes/vibe';
import { rateLimit } from './middleware/rateLimit';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: '*' }));
app.use(express.json());

// Log all requests for debugging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${req.path}`);
  next();
});

app.use('/api/spotify', spotifyRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/vibe', rateLimit, vibeRouter);

// Also mount at /api/api/* in case baseURL was set to http://localhost:3000/api
app.use('/api/api/spotify', spotifyRouter);
app.use('/api/api/upload', uploadRouter);
app.use('/api/api/vibe', rateLimit, vibeRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Catch-all for unknown routes (helps debug 404s)
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.path}`);
  const hint = req.path.startsWith('/api/api/')
    ? ' Base URL should be http://localhost:3000 (no /api suffix).'
    : '';
  res.status(404).json({ error: 'Not found', path: req.path, method: req.method, hint });
});

// Startup: confirm LLM backend (LiteLLM Proxy or direct Gemini)
if (!isLlmConfigured()) {
  console.warn('\n⚠️  No LLM configured. Playlist generation will fail.');
  console.warn('   Option 1: Set LITELLM_PROXY_URL and LITELLM_PROXY_API_KEY');
  console.warn('   Option 2: Set GEMINI_API_KEY (https://aistudio.google.com/apikey)\n');
} else {
  console.log(`[LLM] Using ${getLlmMode() === 'proxy' ? 'LiteLLM Proxy' : 'direct Gemini'}: ${getModelName()}`);
}

const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Vibe Playlist backend running on http://localhost:${PORT} (listening on ${HOST} for LAN access)`);
});
