import axios from 'axios';

const SPOTIFY_BASE = 'https://api.spotify.com/v1';
const ACCOUNTS_BASE = 'https://accounts.spotify.com';

export interface SpotifyAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface GenreSeedsResponse {
  genres: string[];
}

export interface TrackObject {
  id: string;
  uri: string;
  name: string;
  artists: { id: string; name: string }[];
}

export interface RecommendationsResponse {
  tracks: TrackObject[];
}

export interface CreatePlaylistResponse {
  id: string;
  uri: string;
  href: string;
}

export class SpotifyService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID || '';
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
    this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || '';
  }

  getAuthorizationUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'user-read-private user-read-email playlist-modify-public playlist-modify-private playlist-read-private',
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });
    return `${ACCOUNTS_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string,
    codeVerifier: string
  ): Promise<SpotifyAuthTokens> {
    const response = await axios.post(
      `${ACCOUNTS_BASE}/api/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        client_id: this.clientId,
        code_verifier: codeVerifier,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return response.data;
  }

  async refreshAccessToken(refreshToken: string): Promise<SpotifyAuthTokens> {
    const response = await axios.post(
      `${ACCOUNTS_BASE}/api/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    return response.data;
  }

  async getGenreSeeds(accessToken: string): Promise<string[]> {
    const response = await axios.get<GenreSeedsResponse>(
      `${SPOTIFY_BASE}/recommendations/available-genre-seeds`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data.genres;
  }

  async getCurrentUser(accessToken: string): Promise<{ id: string }> {
    const response = await axios.get(`${SPOTIFY_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  async getCurrentUserProfile(
    accessToken: string
  ): Promise<{ id: string; email?: string; display_name?: string }> {
    const response = await axios.get<{ id: string; email?: string; display_name?: string }>(
      `${SPOTIFY_BASE}/me`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return {
      id: response.data.id,
      email: response.data.email,
      display_name: response.data.display_name,
    };
  }

  async searchTracks(
    accessToken: string,
    q: string,
    limit?: number,
    offset?: number
  ): Promise<TrackObject[]> {
    const effectiveLimit = Math.min(limit ?? 10, 10);
    const effectiveOffset = offset ?? 0;

    const doRequest = async (): Promise<TrackObject[]> => {
      const params = new URLSearchParams({
        type: 'track',
        q,
        limit: String(effectiveLimit),
        offset: String(effectiveOffset),
      });
      const response = await axios.get<{ tracks?: { items?: TrackObject[] } }>(
        `${SPOTIFY_BASE}/search?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const items = response.data.tracks?.items ?? [];
      return items.map((t) => ({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: t.artists ?? [],
      }));
    };

    try {
      return await doRequest();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          return await doRequest();
        } catch (retryErr: unknown) {
          await new Promise((r) => setTimeout(r, 2000));
          return await doRequest();
        }
      }
      const errStr = String(err);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'spotify.ts:searchTracksError',message:'Spotify search API error',data:{status,errStr:errStr.slice(0,200),has403:errStr.includes('403')},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      throw err;
    }
  }

  async searchTracksByGenres(
    accessToken: string,
    genres: string[],
    targetCount: number
  ): Promise<TrackObject[]> {
    const seen = new Set<string>();
    const collected: TrackObject[] = [];
    const genreList = genres.slice(0, 5).filter(Boolean);

    const addTracks = (tracks: TrackObject[]) => {
      for (const t of tracks) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          collected.push(t);
        }
      }
    };

    for (const genre of genreList) {
      const genreQuery = genre.includes('-') || genre.includes(' ') ? `genre:"${genre}"` : `genre:${genre}`;
      try {
        const tracks = await this.searchTracks(accessToken, genreQuery, 10);
        if (tracks.length > 0) {
          addTracks(tracks);
          if (collected.length >= targetCount) break;
        } else {
          const keywordTracks = await this.searchTracks(accessToken, genre, 10);
          if (keywordTracks.length > 0) addTracks(keywordTracks);
        }
      } catch {
        const keywordTracks = await this.searchTracks(accessToken, genre, 10);
        if (keywordTracks.length > 0) addTracks(keywordTracks);
      }
    }

    if (collected.length === 0) {
      throw new Error('No tracks found for these genres');
    }

    return collected.slice(0, targetCount);
  }

  async getRecommendations(
    accessToken: string,
    params: {
      seed_genres?: string[];
      seed_artists?: string[];
      seed_tracks?: string[];
      target_valence?: number;
      target_energy?: number;
      target_acousticness?: number;
      target_danceability?: number;
      target_instrumentalness?: number;
      limit?: number;
    }
  ): Promise<TrackObject[]> {
    const searchParams = new URLSearchParams();
    if (params.seed_genres?.length) {
      searchParams.set('seed_genres', params.seed_genres.slice(0, 5).join(','));
    }
    if (params.seed_artists?.length) {
      searchParams.set('seed_artists', params.seed_artists.slice(0, 5).join(','));
    }
    if (params.seed_tracks?.length) {
      searchParams.set('seed_tracks', params.seed_tracks.slice(0, 5).join(','));
    }
    if (params.target_valence != null) searchParams.set('target_valence', String(params.target_valence));
    if (params.target_energy != null) searchParams.set('target_energy', String(params.target_energy));
    if (params.target_acousticness != null) searchParams.set('target_acousticness', String(params.target_acousticness));
    if (params.target_danceability != null) searchParams.set('target_danceability', String(params.target_danceability));
    if (params.target_instrumentalness != null) searchParams.set('target_instrumentalness', String(params.target_instrumentalness));
    searchParams.set('limit', String(params.limit ?? 50));

    const response = await axios.get<{ tracks: TrackObject[] }>(
      `${SPOTIFY_BASE}/recommendations?${searchParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data.tracks;
  }

  async createPlaylist(
    accessToken: string,
    _userId: string,
    name: string,
    description: string
  ): Promise<CreatePlaylistResponse> {
    const response = await axios.post<CreatePlaylistResponse>(
      `${SPOTIFY_BASE}/me/playlists`,
      { name, description, public: true },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data;
  }

  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackUris: string[]
  ): Promise<void> {
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await axios.post(
        `${SPOTIFY_BASE}/playlists/${playlistId}/items`,
        { uris: batch },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    }
  }
}

export const spotifyService = new SpotifyService();
