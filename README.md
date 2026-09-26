# Pixel Dungeon Chase

A local multiplayer browser game for 1–4 people: one collector, three pursuers, and a dungeon full of gold. AI fills unused pursuer slots. Collect all coins to win; a single catch ends the round. Human players take turns as collector.

## Play

- Controls are assigned automatically as human players join: WASD first, then arrow keys, then connected gamepads. A control set belongs to one player only. Three or four human players require gamepads.
- Use a gamepad D-pad or left stick. Press a gamepad button once so the browser detects it before its player joins.
- Press your next direction before reaching a corner to buffer a turn. Movement continues until a wall or another direction.
- Escape pauses/resumes, M toggles sound. Losing focus or disconnecting an assigned controller pauses the game; resuming is explicit.
- The collector moves at 4.5 tiles/second; pursuers at 3.8. Catch collision takes precedence over the last coin.

## Character passes and matchmaking

The separate `/booth/` page is designed to run at the photo station while the game screen remains available. A visitor enters a name, uploads a JPEG, PNG, or WebP photo or takes a camera snapshot, and chooses **Create pixel character**. The server sends that photo to the OpenAI Images API, stores the completed transparent 4×4 sprite sheet, and returns a private character-pass QR. The original photo is not retained by this application.

The visitor scans the result QR once to save the private character pass in their phone browser. They can also download the PNG as a backup. At the game screen, the fullscreen matchmaking lobby shows one shared lobby QR. Scanning it opens the join page, where the visitor taps an open player quadrant to join it (tapping another open quadrant switches slots) and readies up with one tap. The join page offers the character saved on that phone first, and any recent booth character can be picked from the shared character gallery. No sign-in or manual code entry is required.

The game host polls its lobby session, loads claimed characters automatically, and assigns available local controls. Empty slots can be filled with AI. Once every slot is filled and every human player is ready, the host presses **START CHASE** to begin the five-second countdown. Character artwork never changes collision size.

Lobby writes are compare-and-set: every slot action re-reads the lobby and retries if another phone changed it first, so simultaneous joins are never lost.

Character-pass secrets are kept out of server metadata and are only placed in the URL fragment while the pass moves from the booth to the phone. Lobby invitations expire after four hours; Vercel character-pass metadata is retained for seven days. Treat both QRs as private during an event.

## Source and local development

This folder is a self-contained Codex-ready Git project. Open this directory as a local project in Codex so it can discover `AGENTS.md`, use the repository history, and run the documented commands.

Install dependencies with `npm install`, then install the browser once with `npx playwright install chromium`. Set `OPENAI_API_KEY` in the server environment to enable photo generation, start the local preview with `npm run dev`, then open `http://127.0.0.1:4173`. `OPENAI_IMAGE_MODEL` can override the default image-edit model. For UI work without making an API request, set `MOCK_CHARACTER_API=1`. Run engine and behavior verification with `npm test`, real Chromium checks with `npm run test:browser`, or both with `npm run test:all`.

The browser application remains in `dist/`. `npm run build` prepares the static bundle and its Worker files. The OpenAI API key is never exposed to the browser. JavaScript modules require HTTP rather than opening `index.html` directly from disk.

## Vercel deployment

The included `vercel.json` serves `dist/` and deploys the explicit nested routes in `api/` as Vercel Functions. Add these environment variables to the Vercel project:

- `OPENAI_API_KEY`
- `BLOB_READ_WRITE_TOKEN` for a private Vercel Blob store
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `OPENAI_IMAGE_MODEL` only when overriding the default model (`gpt-image-2.5-sunburst`)
- `CHARACTER_RATE_LIMIT` only when changing the number of characters one IP address may generate per 10 minutes (default 20). The booth is a single device, so this is effectively the booth's throughput cap and the guard on API credits. On Vercel the count is shared through Redis; the local server and Worker count per process.

Vercel Blob stores sprite PNGs. Upstash Redis stores character metadata, the recent-character index, short-lived lobby sessions with their revision counters, and generation rate-limit counters. Run `npm run build` and `npm test` before deploying. The repository does not make an OpenAI request during build, tests, or ordinary lobby/gameplay use; credits are used only after a visitor submits a photo for generation.

The simulation is in `dist/engine.mjs`, rendering in `dist/render.mjs`, control normalization in `dist/input.mjs`, and the mute preference in `dist/preferences.mjs`. The page uses Canvas 2D and semantic HTML menus with no runtime framework. The game screen needs the lobby API to fill player slots, but gameplay itself never calls OpenAI and needs no account. Fonts use Google Fonts with local sans-serif fallbacks.

The `npm test` command runs `node --test tests.mjs`. `npm run test:browser` starts the local site automatically and runs the Playwright suite in Chromium. Open its screenshot report with `npm run test:browser:report`; failures also retain screenshots, video and traces under `test-results/`.

Generated character PNGs are included under `dist/assets/`. Built-in imagegen created both sheets; the exact prompts are recorded in `ARTWORK.md`. The returned sheets are 1254 × 1254, so the renderer uses proportional frame boundaries rather than assuming integer 256-pixel cells.

## Verification

The Node suite covers connected maze/coins, 1–4-player setup, countdown, walls, buffered turns, deterministic movement, pause, crossing collisions, scoring, role rotation, fixed player identities, AI navigation, secure character-pass publishing, lobby claiming/readiness, concurrent lobby writes, generation rate limits, quota errors, art-independent collision size, static routes, cache revalidation, and mixed keyboard/gamepad input/disconnection conditions.

Playwright browser QA covers the fullscreen lobby, the effective 150%-zoom desktop size, adding AI players, starting a game, and the final podium at fullscreen and compact desktop sizes. Podium screenshots are attached to the test output for every run. Structured game-state/start/pause tools were exercised through WebMCP, including invalid inputs and invalid-state errors.

Hardware limitation: physical gamepads and separate Chrome/Edge installations were not available to the browser tools. Gamepad inputs were tested with synthetic unit-test fixtures; UI verification used the Codex in-app browser. These are not substitutes for a physical four-player compatibility/play-balance test.

## Version-one boundaries

One map; desktop keyboard/gamepad play; no GIFs, in-game AI generation, online multiplayer, touch controls, power-ups, or timer limit.
