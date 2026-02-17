# Playlist Pilot

Playlist Pilot is a focused web app for tracking progress while watching YouTube playlists. Paste a playlist URL, load the videos, and the app tracks what you have watched.

## Features

- Playlist fetch via the YouTube Data API (client-side).
- Embedded YouTube player with auto-advance.
- Progress tracking per video and overall.
- Local persistence in the browser.

## Tech Stack

- React + Vite + TypeScript
- Tailwind CSS + minimal shadcn/ui primitives
- Supabase edge function for YouTube playlist fetch

## Usage

1. Add `VITE_YOUTUBE_API_KEY` to your `.env` (YouTube Data API v3 key).
2. Start the app with `npm run dev`.
3. Paste a YouTube playlist URL.
4. Watch videos and track progress.

## Notes on Supabase

The UI now calls the YouTube Data API directly with your `VITE_YOUTUBE_API_KEY`. The Supabase Edge Function remains in the repo if you prefer to proxy requests through Supabase; deploy it with your key if you choose that path.
