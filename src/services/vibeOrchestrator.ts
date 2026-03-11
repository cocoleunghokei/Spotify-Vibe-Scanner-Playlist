import path from 'path';
import fs from 'fs';
import { spotifyService } from './spotify';
import { extractAndAnalyzeAudio } from './audio';
import { analyzePhotosAndGetVibe, aggregateVibe, mapGenresToSpotify } from './llm';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

export interface VibeInput {
  fileIds: string[];
  location?: { latitude?: number; longitude?: number; placeName?: string };
  playlistName?: string;
}

export interface VibeResult {
  playlist: { id: string; uri: string; href: string };
  tracksAdded: number;
  vibeDescription?: string;
  vibeTags?: string[];
  tracks?: { id: string; name: string; artist: string; duration_ms?: number }[];
}

export async function createVibePlaylist(
  accessToken: string,
  input: VibeInput
): Promise<VibeResult> {
  const filePaths = input.fileIds
    .map((id) => path.join(UPLOAD_DIR, id))
    .filter((p) => fs.existsSync(p));

  if (filePaths.length === 0) {
    throw new Error('No valid files found');
  }

  const photos = filePaths.filter((p) => /\.(jpg|jpeg|png|heic)$/i.test(p));
  const videos = filePaths.filter((p) => /\.(mp4|mov|m4v)$/i.test(p));

  let photoDescriptions: string[] = [];
  let audioContext = '';
  if (videos.length > 0) {
    try {
      audioContext = await extractAndAnalyzeAudio(videos);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[vibe/generate] Step: audio extraction failed', msg);
      throw new Error(`Audio extraction failed: ${msg}`);
    }
  }

  let user;
  try {
    user = await spotifyService.getCurrentUser(accessToken);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:getCurrentUserOk',message:'Spotify getCurrentUser succeeded',data:{userId:user?.id},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const has403 = msg.includes('403');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:getCurrentUserCatch',message:'Spotify getCurrentUser failed',data:{msg:msg.slice(0,300),has403},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    console.error('[vibe/generate] Step: Spotify getCurrentUser failed', msg);
    throw new Error(`Spotify getCurrentUser failed: ${msg}`);
  }

  let spotifyGenres: string[];
  try {
    spotifyGenres = await spotifyService.getGenreSeeds(accessToken);
  } catch {
    spotifyGenres = [];
  }

  let vibeParams;
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:llmBranch',message:'LLM branch chosen',data:{photosCount:photos.length,videosCount:videos.length,usingPhotos:photos.length>0},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  try {
    if (photos.length > 0) {
      const result = await analyzePhotosAndGetVibe(photos, input.location, audioContext, spotifyGenres);
      photoDescriptions = result.photoDescriptions;
      vibeParams = result.vibeParams;
    } else {
      vibeParams = await aggregateVibe({
        location: input.location,
        photoDescriptions: [],
        audioContext,
        spotifyGenres,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const has403 = msg.includes('403');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:llmCatch',message:'LLM/vibe analysis failed',data:{msg:msg.slice(0,300),has403},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    console.error('[vibe/generate] Step: LLM/vibe analysis failed', msg);
    throw new Error(`LLM/vibe analysis failed: ${msg}`);
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:postLLM',message:'LLM step completed',data:{genreSeeds:vibeParams.genre_seeds?.slice(0,3)},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  let seedGenres =
    spotifyGenres.length > 0
      ? await mapGenresToSpotify(vibeParams.genre_seeds, spotifyGenres)
      : vibeParams.genre_seeds;

  if (spotifyGenres.length > 0) {
    const validSet = new Set(spotifyGenres.map((g) => g.toLowerCase()));
    seedGenres = seedGenres.filter((g) => validSet.has(g.toLowerCase()));
    if (seedGenres.length === 0) seedGenres = spotifyGenres.slice(0, 5);
  }
  if (seedGenres.length === 0) {
    seedGenres = ['ambient', 'road-trip', 'chill'];
  }

  let tracks;
  try {
    tracks = await spotifyService.searchTracksByGenres(accessToken, seedGenres, 50);
  } catch (err) {
    const fallbackGenres = ['ambient', 'chill', 'indie'];
    console.warn('[vibe/generate] Search failed, retrying with fallback genres', fallbackGenres);
    try {
      tracks = await spotifyService.searchTracksByGenres(accessToken, fallbackGenres, 50);
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error('[vibe/generate] Step: Spotify searchTracksByGenres failed', msg);
      throw new Error(`No tracks found. Try different photos or media.`);
    }
  }

  if (tracks.length === 0) {
    throw new Error('No tracks found. Try different photos or media.');
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:beforeCreatePlaylist',message:'about to create playlist',data:{trackCount:tracks.length},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  const playlist = await spotifyService.createPlaylist(
    accessToken,
    user.id,
    input.playlistName || 'Vibe Playlist',
    vibeParams.description || 'Generated from your vibe'
  );
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:afterCreatePlaylist',message:'createPlaylist succeeded',data:{playlistId:playlist.id},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  await spotifyService.addTracksToPlaylist(
    accessToken,
    playlist.id,
    tracks.map((t) => t.uri)
  );

  const splitTags = vibeParams.description?.split(/[,•]/)?.map((s) => s.trim()).filter(Boolean);
  const fallbackTags = ['Road trip', 'Chill', 'Curated'];
  const vibeTags =
    splitTags && splitTags.length > 0
      ? splitTags
      : seedGenres.length > 0
        ? seedGenres.slice(0, 5)
        : fallbackTags;
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'vibeOrchestrator.ts:vibeTags',message:'vibeTags computed',data:{description:vibeParams.description,splitTags:splitTags,source:splitTags?.length?'split':'fallback',vibeTags:vibeTags},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  return {
    playlist: { id: playlist.id, uri: playlist.uri, href: playlist.href },
    tracksAdded: tracks.length,
    vibeDescription: vibeParams.description,
    vibeTags,
    tracks: tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artists?.[0]?.name ?? 'Unknown',
      duration_ms: 0,
    })),
  };
}
