# Pixel Dungeon Chase

A local multiplayer browser game for 1–4 people: one collector, three pursuers, and a dungeon full of gold. AI fills unused pursuer slots. Collect all coins to win; a single catch ends the round. Human players take turns as collector.

## Play

- Controls are assigned automatically as human players join: WASD first, then arrow keys, then connected gamepads. A control set belongs to one player only. Three or four human players require gamepads.
- Use a gamepad D-pad or left stick. Press a gamepad button once so the browser detects it before its player joins.
- Press your next direction before reaching a corner to buffer a turn. Movement continues until a wall or another direction.
- Escape pauses/resumes, M toggles sound. Losing focus or disconnecting an assigned controller pauses the game; resuming is explicit.
- The collector moves at 4.5 tiles/second; pursuers at 3.8. Catch collision takes precedence over the last coin.

## Character passes and matchmaking

The crew runs `/booth/` on one device. Enter the attendee's name and use **Use live camera → Take photo & start**, or choose an existing photo and press **Start generation & show QR**. Photos are resized before upload. Once the upload is accepted, the capture form is replaced by a personal progress QR. Help the guest scan it, then press **Generate next character** to return to a fresh capture form while generation continues. The corner history icon opens recent attendees to recover earlier QRs, including after a page refresh.

Attendees scan that QR with their phone camera to open `/character/`. The page polls real stages: photo received, character design, walking animation, waving animation, finishing, ready. They can leave the booth while this runs. When ready, they see both animations and can share separate six-second 1080×1920 H.264 MP4 clips. MP4 export runs locally in a Web Worker using WebAssembly, defaults to the event frame with the character’s name, with a plain black alternative, and does not upload anything to Instagram or require an Instagram account. There are no sprite-sheet downloads or separate Save step in the attendee flow. Sharing uses the native file share sheet; browsers without file sharing download directly. If encoding outlasts the user gesture, the same Share button opens the prepared file on a fresh tap. Full-HD frames are fed to the encoder one at a time to limit phone memory use. Actual sharing to a phone's photo library depends on its browser/share sheet.

**Join a game using this character** validates and saves the character pass on that phone, then opens `/join/`. The built-in scanner uses the rear camera to read the game screen's shared lobby QR; attendees can also select a QR image or paste an invitation URL if camera permission is denied. Only lobby links from this event's origin are accepted. The visitor chooses an available player quadrant and readies up. Their saved character remains available even after it drops out of the recent-character gallery. Existing private pass URLs still work through `/pass/`.

New characters have separate internal 4×4 directional walk and hello-wave sheets. Matchmaking and podium portraits use the wave; gameplay uses the walk. Older characters without a wave keep a still greeting portrait. Reduced-motion previews hold a still pose; downloadable videos remain animated.

Character generation uses the selected **Style A** illustration as a second image reference. The attendee photo is first and supplies identity and clothing; Style A supplies detailed pixel shading, facial treatment and approximately 2.5-head-tall proportions. A single 1024px character design is generated first; both 2048px animation sheets use that same finished design as their only image reference. All three requests use high quality. This separates appearance from animation so the sheet request is less likely to change the proportions. The intermediate design stays in task memory and is not persisted. The shared reference PNG is embedded in `worker/character-style-reference.mjs` so local, Vercel and Worker hosts send identical reference bytes without an extra network fetch. This is generated reference artwork, not a stored attendee photo.

Generation uses three sequential image-edit requests per character. Several attendees' jobs can run concurrently, but the existing per-IP generation limit still applies. Original photos are held only in request/task memory, never persisted. Failed jobs require the booth to submit another photo; there is no durable photo queue or automatic paid retry. Upload retries with the same ticket are idempotent.

The new background workflow is enabled on the current **Vercel** deployment and local development server. Vercel uses `@vercel/functions` `waitUntil`, Redis job records, and a 300-second function budget; an unfinished job reports a timeout after 270 seconds. Jobs/progress links expire after 24 hours. The legacy synchronous generation API remains available on all hosts. A Sites/Cloudflare deployment needs a compatible long-running background runner before enabling this new crew workflow; it deliberately rejects background submissions rather than promising jobs that its short post-response lifetime cannot finish. An unexpected host shutdown is surfaced as a timeout, and the crew must retake/resubmit the photo.

`MOCK_CHARACTER_API=1` uses existing artwork for local development and does not validate actual AI-generated art. No generation credits are used by the test suite.

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

Vercel Blob stores sprite PNGs. Upstash Redis stores private generation-job state, character metadata, the recent-character index, short-lived lobby sessions with their revision counters, and generation rate-limit counters. Run `npm run build` and `npm test` before deploying. The repository does not make an OpenAI request during build, tests, or ordinary lobby/gameplay use; credits are used only after a visitor submits a photo for generation.

The simulation is in `dist/engine.mjs`, rendering in `dist/render.mjs`, control normalization in `dist/input.mjs`, and the mute preference in `dist/preferences.mjs`. The page uses Canvas 2D and semantic HTML menus with no runtime framework. The game screen needs the lobby API to fill player slots, but gameplay itself never calls OpenAI and needs no account. Fonts use Google Fonts with local sans-serif fallbacks.

The `npm test` command runs `node --test tests.mjs`. `npm run test:browser` starts the local site automatically and runs the Playwright suite in Chromium. Open its screenshot report with `npm run test:browser:report`; failures also retain screenshots, video and traces under `test-results/`.

Generated character PNGs are included under `dist/assets/`. Built-in imagegen created both sheets; the exact prompts are recorded in `ARTWORK.md`. The returned sheets are 1254 × 1254, so the renderer uses proportional frame boundaries rather than assuming integer 256-pixel cells.

## Verification

The Node suite covers connected maze/coins, 1–4-player setup, countdown, walls, buffered turns, deterministic movement, pause, crossing collisions, scoring, role rotation, fixed player identities, AI navigation, secure character-pass publishing, lobby claiming/readiness, concurrent lobby writes, generation rate limits, quota errors, art-independent collision size, static routes, cache revalidation, and mixed keyboard/gamepad input/disconnection conditions.

Playwright browser QA covers the fullscreen lobby, the effective 150%-zoom desktop size, adding AI players, starting a game, and the final podium at fullscreen and compact desktop sizes. Podium screenshots are attached to the test output for every run. Structured game-state/start/pause tools were exercised through WebMCP, including invalid inputs and invalid-state errors.

The booth tests exercise overlapping attendee jobs, private progress links, duplicate submissions, expired jobs, camera capture, QR recovery after refresh, MP4 encoding and playback, pass creation, and scanning a real lobby QR image. Desktop and narrow layouts are captured for review. Generation uses fixture artwork; camera permission and media streams are simulated in Chromium, so event-device camera and native phone sharing still need a hardware check.

Hardware limitation: physical gamepads and separate Chrome/Edge installations were not available to the browser tools. Gamepad inputs were tested with synthetic unit-test fixtures; UI verification used the Codex in-app browser. These are not substitutes for a physical four-player compatibility/play-balance test.

## Version-one boundaries

One map; desktop keyboard/gamepad play; no GIFs, in-game AI generation, online multiplayer, touch controls, power-ups, or timer limit.
