import { Router } from 'express';
import { createVibePlaylist } from '../services/vibeOrchestrator';

export const vibeRouter = Router();

const MAX_PHOTOS = 5;
const MAX_VIDEOS = 2;
const MAX_VIDEO_SIZE_MB = 50;

vibeRouter.post('/generate', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const accessToken = auth.slice(7);
  const { fileIds, location, playlistName } = req.body;

  if (!fileIds?.length) {
    return res.status(400).json({ error: 'At least one file (photo or video) required' });
  }
  if (fileIds.length > MAX_PHOTOS + MAX_VIDEOS) {
    return res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos and ${MAX_VIDEOS} videos allowed` });
  }

  try {
    const result = await createVibePlaylist(accessToken, {
      fileIds,
      location: location || {},
      playlistName: playlistName || 'Vibe Playlist',
    });
    res.json({
      ...result,
      vibeTags: result.vibeTags,
      tracks: result.tracks,
    });
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : 'Failed to generate playlist';
    const errStr = String(err);
    const has403 = errStr.includes('403');
    const hasSpotify = errStr.toLowerCase().includes('spotify');
    const hasLlm = errStr.toLowerCase().includes('llm') || errStr.toLowerCase().includes('gemini') || errStr.toLowerCase().includes('litellm');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibe.ts:catch',message:'vibe generate failed',data:{message:rawMessage,errStr:errStr.slice(0,300),has403,hasSpotify,hasLlm},timestamp:Date.now(),hypothesisId:'H1,H2'})}).catch(()=>{});
    // #endregion
    const message = has403
      ? 'Spotify denied access (403). In Development Mode you must add your Spotify email to the app allowlist: Spotify Developer Dashboard → Your App → Users and Access → Add new user.'
      : rawMessage;
    console.error('[vibe/generate]', rawMessage);
    res.status(500).json({ error: message });
  }
});
