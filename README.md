# Vibe Playlist

Generate Spotify playlists from your location, photos, and videos. Capture the moment on a road trip, and the app matches the vibe to music.

## Architecture

- **iOS App**: Camera capture, location, Spotify OAuth, upload media, trigger playlist generation
- **Backend**: Node.js/Express - Spotify API, AI (OpenAI Vision + Whisper + LLM), FFmpeg for audio extraction
- **Flow**: Photos → Vision API; Videos → FFmpeg (extract audio) → Whisper; Location + descriptions → LLM → Spotify Search (genre-based) → Create Playlist

## Setup

### 1. Spotify Developer

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an app, note Client ID and Client Secret
3. Add Redirect URI: `vibeplaylist://callback` (for iOS)

### 2. Backend

Never commit `.env` (it contains secrets). It is in `.gitignore`. If credentials were ever committed, rotate them immediately in Spotify Developer Dashboard and Google AI Studio.

```bash
cd vibe-playlist
cp .env.example .env
# Edit .env with:
#   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
#   SPOTIFY_REDIRECT_URI=vibeplaylist://callback
#   LLM (choose one):
#     - LITELLM_PROXY_URL + LITELLM_PROXY_API_KEY (preferred, uses gemini-2.5-pro)
#     - GEMINI_API_KEY (fallback, get from https://aistudio.google.com/apikey)

npm install
brew install ffmpeg  # Required for video audio extraction
npm run dev
```

**LLM options**: Use LiteLLM Proxy (`LITELLM_PROXY_URL` + `LITELLM_PROXY_API_KEY`) for gemini-2.5-pro, or fall back to `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey). Proxy requires VPN for external access.

Backend runs at `http://localhost:3000`.

### 3. iOS App

1. Open `ios-app/VibePlaylist.xcodeproj` in Xcode
2. For simulator: set backend URL in Settings to `http://localhost:3000`. **Location:** If location shows "Not detected", choose **Debug → Simulate Location → Australia** (or **Custom Location** and pick a GPX). The scheme defaults to Australia.gpx, but you may need to select it manually. (Simulator has no real GPS)
3. For device: use your machine's local IP (e.g. `http://192.168.1.x:3000`) and ensure device is on same network
4. Build and run

### 4. Spotify OAuth

The app opens Spotify's login in Safari. After login, Spotify redirects to `vibeplaylist://callback` which opens the app. Ensure the redirect URI in Spotify Dashboard exactly matches.

## Usage

1. **Connect Spotify** – Tap "Connect with Spotify" and authorize
2. **Capture** – Take photos and short videos (or add from album). Tap Generate Playlist. AI analyzes media and creates a playlist.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/spotify/auth-url | Get OAuth URL (PKCE) |
| POST | /api/spotify/exchange | Exchange code for tokens |
| POST | /api/spotify/create-playlist | Create playlist from seeds |
| POST | /api/upload/media | Upload photos/videos |
| POST | /api/vibe/generate | Generate playlist from uploaded media |

## Cost Notes

- ~$0.10–0.20 per vibe generation (Vision + Whisper + LLM)
- Rate limit: 10 vibe generations per IP per minute

## Troubleshooting

### Playlist generation fails

**"Spotify denied access (403)"** – In Development Mode, you must add your Spotify account to the app allowlist. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → Your App → Users and Access → Add new user, and enter your Spotify email. Up to 5 users can be allowlisted in development mode.

**"No tracks found"** – Try different photos or media to get different genre suggestions from the LLM.
