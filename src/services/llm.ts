import fs from 'fs';
import {
  chatWithImages,
  chatText,
  isLlmConfigured,
} from './llmClient';

export interface VibeParams {
  genre_seeds: string[];
  seed_artists?: string[];
  seed_tracks?: string[];
  target_valence?: number;
  target_energy?: number;
  target_acousticness?: number;
  description: string;
}

export interface AggregateVibeInput {
  location?: { latitude?: number; longitude?: number; placeName?: string };
  photoDescriptions: string[];
  audioContext: string;
  spotifyGenres?: string[];
}

const SPOTIFY_GENRES =
  'acoustic,afrobeat,alt-rock,alternative,ambient,anthropology,black-metal,bluegrass,blues,brazil,british,cantopop,chicago-house,children,chill,classical,club,comedy,country,dance,dancehall,death-metal,deep-house,detroit-techno,disco,disney,drum-and-bass,dub,dubstep,edm,electro,electronic,emo,folk,forro,french,funk,garage,german,gospel,goth,grip,grunge,guitar,happy,hard-rock,hardcore,hardstyle,heavy-metal,hip-hop,holidays,honky-tonk,house,idm,indian,indie,indie-pop,industrial,iranian,j-dance,j-idol,j-pop,j-rock,jazz,k-pop,kids,latin,latino,malay,mandopop,metal,metal-misc,metalcore,minimal-techno,movies,mpb,new-age,opera,party,philippines-opm,piano,pop,pop-film,post-dubstep,power-pop,progressive-house,psych-rock,punk,punk-rock,r-n-b,rainy-day,reggae,reggaeton,road-trip,rock,rock-n-roll,romance,sad,salsa,samba,sertanejo,show-tunes,singer-songwriter,ska,sleep,songwriter,soul,soundtracks,spanish,study,summer,swedish,synth-pop,tango,techno,trance,trip-hop,turkish,work-out,world-music';

const DEFAULT_GENRES = ['ambient', 'road-trip', 'chill'];

/** Map LLM-suggested genres to Spotify's exact genre seeds. Filters invalid ones, finds similar keywords. */
export async function mapGenresToSpotify(
  llmGenres: string[],
  spotifyGenres: string[]
): Promise<string[]> {
  const spotifySet = new Set(spotifyGenres.map((g) => g.toLowerCase()));
  const lookup = (g: string) => spotifyGenres.find((sg) => sg.toLowerCase() === g.toLowerCase());

  if (!isLlmConfigured()) {
    const matched = (llmGenres || [])
      .map((g) => lookup(g))
      .filter((g): g is string => !!g);
    return matched.length > 0 ? matched.slice(0, 5) : DEFAULT_GENRES;
  }

  const validDefaults = DEFAULT_GENRES.filter((g) => spotifySet.has(g));
  const fallback = validDefaults.length > 0 ? validDefaults : spotifyGenres.slice(0, 3);

  if (!llmGenres?.length) return fallback;

  const systemInstruction = `You are a genre-mapping assistant. Given suggested genres from a vibe analysis and Spotify's exact allowed genre list, return 2-5 genres from the Spotify list that best match the intent. Filter out irrelevant suggestions. When our terms are similar to a Spotify term (e.g. "chillout"→"chill", "indie rock"→"indie"), use that Spotify term. Output ONLY a JSON array of strings, each exactly as it appears in the Spotify list. No markdown.`;

  const userMessage = `LLM-suggested genres: ${JSON.stringify(llmGenres)}. Valid Spotify genres: ${spotifyGenres.join(', ')}.`;

  try {
    const raw = await chatText(systemInstruction, userMessage, {
      responseMimeType: 'application/json',
      maxTokens: 150,
      temperature: 0.8,
    });
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.genres ?? parsed.genre_seeds ?? [];
    const valid = arr
      .filter((g: unknown): g is string => typeof g === 'string')
      .map((g: string) => lookup(g.trim()))
      .filter((g: string | undefined): g is string => !!g);

    return valid.length > 0 ? valid.slice(0, 5) : fallback;
  } catch {
    return fallback;
  }
}

/** Single Gemini call: analyze photos + get vibe params. Reduces from 2 calls to 1. */
export async function analyzePhotosAndGetVibe(
  photoPaths: string[],
  location?: { placeName?: string },
  audioContext = '',
  spotifyGenres?: string[]
): Promise<{ photoDescriptions: string[]; vibeParams: VibeParams }> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:analyzePhotosEntry',message:'analyzePhotosAndGetVibe entry',data:{photoPaths:photoPaths.length,isLlmConfigured:isLlmConfigured(),willSkipLlm:!isLlmConfigured()||photoPaths.length===0},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
  // #endregion
  if (!isLlmConfigured() || photoPaths.length === 0) {
    return {
      photoDescriptions: photoPaths.map(() => 'Unknown scene'),
      vibeParams: await aggregateVibe({
        location,
        photoDescriptions: [],
        audioContext,
        spotifyGenres,
      }),
    };
  }

  const images: { mimeType: string; data: string }[] = [];
  for (const filePath of photoPaths) {
    const buf = fs.readFileSync(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
    images.push({ mimeType: mime, data: buf.toString('base64') });
  }

  const contextParts: string[] = [];
  if (location?.placeName) contextParts.push(`Location: ${location.placeName}`);
  if (audioContext) contextParts.push(`Audio context: ${audioContext}`);

  const genreList = spotifyGenres?.length ? spotifyGenres.join(', ') : SPOTIFY_GENRES;
  const text = `Look at these ${photoPaths.length} image(s). ${contextParts.length ? contextParts.join('. ') + '. ' : ''}
For each image, write a 1-2 sentence description (scene, mood, vibe). Then output a JSON object with:
- photoDescriptions: array of your image descriptions in order
- genre_seeds: array of 2-5 genres from: ${genreList}
- target_valence: 0-1 (0.7=uplifting)
- target_energy: 0-1 (0.4=calm)
- target_acousticness: 0-1 (0.6=acoustic)
- description: 3-5 comma-separated vibe tags. Derive from what you see: objects, colors, atmosphere, activity. Avoid generic placeholders.

Output ONLY valid JSON, no markdown.`;

  const raw = await chatWithImages(images, text, {
    responseMimeType: 'application/json',
    maxTokens: 500,
    temperature: 0.9,
  });
  if (!raw) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:analyzePhotosEmptyRaw',message:'LLM returned empty, falling back to aggregateVibe',data:{},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return {
      photoDescriptions: photoPaths.map(() => 'Unknown scene'),
      vibeParams: await aggregateVibe({ location, photoDescriptions: [], audioContext, spotifyGenres }),
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      photoDescriptions?: string[];
      genre_seeds?: string[];
      target_valence?: number;
      target_energy?: number;
      target_acousticness?: number;
      description?: string;
    };
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:analyzePhotosParsed',message:'LLM parsed response',data:{rawDescription:parsed.description,hasDescription:typeof parsed.description==='string',descriptionLen:(parsed.description||'').length},timestamp:Date.now(),hypothesisId:'H4,H3'})}).catch(()=>{});
    // #endregion
    const descs = Array.isArray(parsed.photoDescriptions)
      ? parsed.photoDescriptions
      : photoPaths.map(() => 'Unknown scene');
    return {
      photoDescriptions: photoPaths.map((_, i) => (typeof descs[i] === 'string' ? descs[i] : 'Unknown scene')),
      vibeParams: {
        genre_seeds: Array.isArray(parsed.genre_seeds) ? parsed.genre_seeds.slice(0, 5) : ['ambient', 'road-trip'],
        target_valence: typeof parsed.target_valence === 'number' ? parsed.target_valence : 0.6,
        target_energy: typeof parsed.target_energy === 'number' ? parsed.target_energy : 0.4,
        target_acousticness: typeof parsed.target_acousticness === 'number' ? parsed.target_acousticness : 0.5,
        description: typeof parsed.description === 'string' ? parsed.description : 'Generated from your vibe',
      },
    };
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:analyzePhotosCatch',message:'analyzePhotos JSON parse failed',data:{err:String(e).slice(0,200),rawLen:raw?.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return {
      photoDescriptions: photoPaths.map(() => 'Unknown scene'),
      vibeParams: await aggregateVibe({ location, photoDescriptions: [], audioContext, spotifyGenres }),
    };
  }
}

export async function aggregateVibe(input: AggregateVibeInput): Promise<VibeParams> {
  const parts = [
    input.location?.placeName ? `Location: ${input.location.placeName}` : null,
    input.photoDescriptions.length ? `Photo descriptions: ${input.photoDescriptions.join('; ')}` : null,
    input.audioContext ? `Audio context: ${input.audioContext}` : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return {
      genre_seeds: ['ambient', 'road-trip'],
      target_valence: 0.6,
      target_energy: 0.4,
      target_acousticness: 0.5,
      description: 'Relaxing road trip vibes',
    };
  }

  if (!isLlmConfigured()) {
    return {
      genre_seeds: ['ambient', 'road-trip', 'folk'],
      target_valence: 0.7,
      target_energy: 0.4,
      target_acousticness: 0.6,
      description: 'Epic road trip, vast landscapes',
    };
  }

  const genreList = input.spotifyGenres?.length ? input.spotifyGenres.join(', ') : SPOTIFY_GENRES;
  const systemInstruction = `You are a music curator. Given context about a location, photos, and audio, output a JSON object with:
- genre_seeds: array of 2-5 genres from this exact list: ${genreList}
- target_valence: 0-1 (musical positiveness, 0.7 = happy/uplifting)
- target_energy: 0-1 (0.4 = calm, 0.8 = energetic)
- target_acousticness: 0-1 (0.6 = somewhat acoustic)
- description: 3-5 comma-separated vibe tags. Derive from the photo descriptions and context. Be specific to the scene. Avoid generic placeholders.

Output ONLY valid JSON, no markdown or extra text.`;

  const userContext = parts.join('\n');

  const raw = await chatText(systemInstruction, userContext, {
    responseMimeType: 'application/json',
    maxTokens: 300,
    temperature: 0.9,
  });
  if (!raw) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:aggregateVibeEmptyRaw',message:'aggregateVibe chatText returned empty',data:{partsLen:parts.length},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    return {
      genre_seeds: ['ambient', 'road-trip'],
      target_valence: 0.6,
      target_energy: 0.4,
      target_acousticness: 0.5,
      description: 'Generated playlist',
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VibeParams>;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:aggregateVibeParsed',message:'aggregateVibe LLM response',data:{rawDescription:parsed.description,hasDescription:typeof parsed.description==='string'},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    return {
      genre_seeds: Array.isArray(parsed.genre_seeds) ? parsed.genre_seeds.slice(0, 5) : ['ambient', 'road-trip'],
      seed_artists: parsed.seed_artists,
      seed_tracks: parsed.seed_tracks,
      target_valence: typeof parsed.target_valence === 'number' ? parsed.target_valence : 0.6,
      target_energy: typeof parsed.target_energy === 'number' ? parsed.target_energy : 0.4,
      target_acousticness: typeof parsed.target_acousticness === 'number' ? parsed.target_acousticness : 0.5,
      description: typeof parsed.description === 'string' ? parsed.description : 'Generated from your vibe',
    };
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llm.ts:aggregateVibeCatch',message:'aggregateVibe JSON parse failed',data:{err:String(e).slice(0,200)},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return {
      genre_seeds: ['ambient', 'road-trip'],
      target_valence: 0.6,
      target_energy: 0.4,
      target_acousticness: 0.5,
      description: 'Generated playlist',
    };
  }
}
