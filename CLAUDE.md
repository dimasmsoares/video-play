# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (none external — this is a no-op currently)
npm run dev          # Run in development mode (NODE_ENV=development, no cache headers)
npm start            # Run in production mode
npm run hash-password -- "yourpassword"  # Generate scrypt hash for APP_PASSWORD_HASH
```

No build step, no test suite, no linter configured. The server runs directly with `node server.js`.

Copy `.env.example` to `.env` and populate it before running locally. The `videos/` directory is the library root in dev (set via `VIDEO_ROOT`).

## Architecture

Single-file backend (`server.js`) with a plain Node.js HTTP server — no framework, no external npm dependencies. Everything uses built-in Node modules: `http`, `fs`, `crypto`, `path`, `url`.

**Request routing** is handled manually in `server.js`. Key routes:
- `GET /login.html`, `POST /api/login`, `POST /api/logout` — auth
- `GET /api/library?path=...` — directory listing (folders + videos)
- `GET /video/<encoded-path>` — video file streaming with HTTP range support
- `GET /public/*` — static assets served without auth check

**Authentication** uses HMAC-signed session tokens stored in an `HttpOnly` cookie. Token format: `timestamp.username.signature`. No database, no server-side session state. Password verification uses `scrypt` + `crypto.timingSafeEqual` to prevent timing attacks.

**Video streaming** (`server.js`) implements HTTP range requests (RFC 7233) to support seek/scrub on Safari and iOS. Requests with a `Range` header get a `206 Partial Content` response with correct `Content-Range`. Suffix byte ranges (e.g., `bytes=-500`) are also handled.

**Path safety**: All file paths are resolved with `path.resolve` and validated against `VIDEO_ROOT` to prevent directory traversal. Encoded path segments in video URLs are decoded with `decodeURIComponent`.

**Frontend** (`public/`) is vanilla JS + HTML5 + CSS. `app.js` handles client-side folder navigation (replaces history state), video grid rendering, and search filtering. The video player is a native `<video>` element; the `src` is set dynamically to `/video/<encoded-path>`. UI language is Portuguese.

## Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `VIDEO_ROOT` | Absolute path to video library root |
| `APP_USERNAME` | Login username |
| `APP_PASSWORD` | Plain-text password (dev only) |
| `APP_PASSWORD_HASH` | Preferred: `scrypt:salt:hash` from `npm run hash-password` |
| `SESSION_SECRET` | HMAC key for signing session tokens — must be set before exposing to internet |
| `TRUST_PROXY` | Set `true` when behind an HTTPS reverse proxy (enables secure cookie flag) |
| `NODE_ENV` | `development` skips cache headers on static assets |

## Docker

```bash
docker build -t video-play .
docker run -d --name video-play --restart unless-stopped \
  --env-file .env -p 3000:3000 \
  -v /path/to/videos:/srv/videos:ro \
  video-play
```

The image is Alpine Node.js 20. Mount the video library read-only (`:ro`).

## Supported Video Formats

MP4, M4V, WebM, MOV, MKV, AVI, M3U8. For maximum device compatibility (Safari/iOS), use H.264 + AAC in an MP4 container. MKV may not play on Safari/iOS.
