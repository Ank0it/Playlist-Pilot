# Playlist Pilot

Watch smarter, not longer. Playlist Pilot is a focused web client for pulling in any YouTube playlist, playing it with a clean UI, and tracking what you have finished.

## Why it feels good
- Crisp, responsive layout built with Tailwind and shadcn/ui primitives
- Focused player view with progress at a glance
- Smooth state flows powered by React + TypeScript + Vite
- Works in the browser with local persistence; no extra accounts

## Core features
- Paste a YouTube playlist URL and load titles, durations, and ordering
- Embedded player with simple controls and watch-state tracking
- Per-video and overall progress indicators
- Optional Supabase edge function to proxy playlist fetches

## Frontend stack
- React + TypeScript (Vite)
- Tailwind CSS with shadcn/ui components
- Supabase Edge Functions (optional backend helper)

## Getting started
1) Install dependencies
```
npm install
```
2) Add environment
```
VITE_YOUTUBE_API_KEY=your_youtube_data_api_v3_key
```
3) Run the dev server
```
npm run dev
```
4) Paste a playlist URL and start watching

## Scripts
- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — lint the project

## Architecture & flow
- Client: Vite + React + TypeScript renders the UI, manages playlist state, and drives the YouTube iframe/player.
- Data fetch: by default, the browser calls the YouTube Data API v3 with `VITE_YOUTUBE_API_KEY` to pull playlist items (title, id, duration, order).
- Optional proxy: a Supabase Edge Function can sit between the client and YouTube to hide keys or add rate-limit logic; the client swaps the fetch URL accordingly.
- Playback loop: when you select a video, the embedded player loads it, listens for end events, and advances to the next item while updating local progress.
- Persistence: watch-state is cached locally so you keep progress between sessions without signing in.

## Supabase option
The UI can hit YouTube directly with `VITE_YOUTUBE_API_KEY`. If you prefer to hide the key server-side, deploy the provided Supabase Edge Function and point the client to it.
