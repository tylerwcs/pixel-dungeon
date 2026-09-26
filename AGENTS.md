# Pixel Dungeon Chase

## Project overview

A local multiplayer dungeon chase built for an event (Ecopialand Year End Party 2026). One screen runs the game; visitors create pixel characters from a photo at a booth and join lobby slots from their phones. The browser code is framework-free static files in `dist/`; a small API handles character generation and lobby sessions.

## Layout

Browser (`dist/`, served as static files):

- `index.html`, `app.mjs` — game screen: lobby polling, slot/ready state, control assignment, round flow, scoring, podium
- `engine.mjs` — fixed-step simulation, maze, AI and collisions (pure; imported by the Node tests)
- `render.mjs` — Canvas 2D drawing; detects sprite frames from alpha so imperfect generated sheets stay anchored; `playerNames` gives in-game character names
- `labels.mjs` — round-result wording (who caught whom, per-player gold); pure, unit-tested
- `input.mjs` — keyboard and gamepad normalization
- `preferences.mjs` — IndexedDB mute preference
- `booth/` — photo booth that generates a character and shows its pass QR
- `pass/` — saves a character pass on the visitor's phone
- `join/` — phone view of the lobby: claim a slot quadrant, ready up
- `qr.mjs`, `vendor/qrcode.mjs` — QR drawing (`vendor/` is copied from `node_modules` by the build)

API (`worker/`, the single source of truth for server logic):

- `app-api.mjs` routes `/api/characters*` to `character-api.mjs` and `/api/lobbies*` to `lobby-api.mjs`
- Storage and rate limiting are injected through `options`, so the same handlers run on every host

Hosts for that API:

- `scripts/serve.mjs` — local dev server; in-memory storage
- `api/` + `vercel.json` — Vercel Functions; `api/_runtime.mjs` supplies Upstash Redis + Vercel Blob storage and a Redis rate limiter
- `dist/server/` + `.openai/hosting.json` — Sites Worker with R2 storage, **generated** by `npm run build`

## Commands

- `npm run dev` — local site at `http://127.0.0.1:4173`. `MOCK_CHARACTER_API=1` in `.env.local` fakes photo generation with no API spend.
- `npm test` — Node suite (`tests.mjs`)
- `npm run test:browser` — Playwright in Chromium (`browser-tests/`)
- `npm run build` — regenerates `dist/server/` and `dist/vendor/`

## Gotchas

- `dist/server/` is build output. Edit `worker/`, then run `npm run build` and commit the regenerated files. The build also bundles every `dist/` asset into `dist/server/assets.generated.mjs`, so run it after any `dist/` change that ships to Sites.
- Many tests in `tests.mjs` assert on source text (regexes over `app.mjs`, `index.html`, `style.css`), including the `?v=` cache-busting tags. When you change markup, copy, CSS or a version tag, update the matching assertion in the same change.
- `?v=` tags: bump the tag on a file's `<link>`/`<script>`/`import` when you change that file. Every importer of a module uses the same tag, or the browser loads two separate module instances.
- `style.css` is shared by the game, booth, join and pass pages. Check all four before removing a rule.
- Lobby storage is compare-and-set. `read(id)` returns `{lobby, version}` and `write(id, lobby, version)` returns `false` if someone else wrote first; `lobby-api.mjs` retries. New storage backends implement that contract. Memory storage must clone on read so tests reproduce races.
- Photo generation is limited per client IP (`CHARACTER_RATE_LIMIT`, default 20 per 10 minutes). The booth is one device, so this limit is the booth's throughput cap.
- Git reports "dubious ownership" here (the folder belongs to another Windows user). Pass `-c safe.directory=*` on git commands rather than changing global config.

## Development rules

- Keep simulation behavior deterministic on the existing fixed 1/60 s timestep.
- Character artwork never affects collision size or gameplay.
- Sprite sheets are 4×4 with rows in order: down, left, right, up.
- The OpenAI API key stays server-side; photos are sent for generation and never stored.
- Add a dependency only when a feature clearly needs one; the browser code loads no framework.
- Run `npm test` after any change to game logic, input, round flow, lobby or character APIs.
- For visual changes, check the lobby and gameplay in a browser at desktop and narrow widths, and run `npm run test:browser`.

## Product boundaries

Desktop keyboard/gamepad play on one shared screen, one maze, four rounds with a rotating collector. Phones are used only to join lobby slots and ready up; they do not control characters. Out of scope: online play, touch controls, GIF import, power-ups, round timer.
