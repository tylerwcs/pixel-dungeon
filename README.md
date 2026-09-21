# Pixel Dungeon Chase

A local multiplayer browser game for 1–4 people: one collector, three pursuers, and a dungeon full of gold. AI fills unused pursuer slots. Collect all coins to win; a single catch ends the round. Human players take turns as collector.

## Play

- Assign WASD, arrow keys, or connected gamepads to player slots in the lobby. A control set belongs to one player only. Three or four human players require gamepads.
- Use a gamepad D-pad or left stick. Press a gamepad button once to let the browser detect it, then select it from the control menu.
- Press your next direction before reaching a corner to buffer a turn. Movement continues until a wall or another direction.
- Escape pauses/resumes, M toggles sound. Losing focus or disconnecting an assigned controller pauses the game; resuming is explicit.
- The collector moves at 4.5 tiles/second; pursuers at 3.8. Catch collision takes precedence over the last coin.

## Custom characters

Use the pencil button on a player card. Collector and pursuer appearances are separate. Import a PNG still image (1 column, 1 row), a single-row walking strip, or a directional sheet with exactly four rows: down, left, right, up. Set the column count and frame rate, inspect the animated preview, then choose **Use character**. PNGs can be up to 5 MB and 4096 × 4096 pixels. Transparent backgrounds work best. All cells must be equally sized and the character centered. Artwork never determines collision size.

The separate `/booth/` page is designed to run on another device or station while the game continues. A visitor enters a character name, uploads a JPEG, PNG, or WebP image or takes a camera snapshot, and chooses **Create pixel character**. The photo is sent to the OpenAI Images API and discarded by the game after generation. The completed transparent 4×4 sprite sheet is stored in the shared character library.

Open game lobbies refresh that library automatically every few seconds. Each player card includes a character list, so newly completed booth characters appear without reloading or interrupting a round. Selecting a booth character applies it to that player in both roles. The pencil editor remains available for device-local, role-specific PNG imports.

The editor links to the included 4×4 adventurer sheet as a downloadable example. Characters, controls, and mute state stay in this browser via IndexedDB; no images are sent to a server. Each web origin has separate saved settings, so the local preview and hosted game do not share imports.

## Source and local development

This folder is a self-contained Codex-ready Git project. Open this directory as a local project in Codex so it can discover `AGENTS.md`, use the repository history, and run the documented commands.

No package installation is required. Set `OPENAI_API_KEY` in the server environment to enable photo generation, start the local preview with `npm run dev`, then open `http://127.0.0.1:4173`. `OPENAI_IMAGE_MODEL` can override the default image-edit model. For UI work without making an API request, set `MOCK_CHARACTER_API=1`. Run automated verification with `npm test`.

The browser application remains in `dist/`. `npm run build` adds a Cloudflare Worker entrypoint that serves those files, securely proxies photo generation, and stores completed sprites in the configured `CHARACTERS` R2 binding. The OpenAI API key is never exposed to the browser. JavaScript modules require HTTP rather than opening index.html directly from disk.

The simulation is in `dist/engine.mjs`, rendering in `dist/render.mjs`, control normalization in `dist/input.mjs`, and the PNG editor/storage in `dist/characters.mjs`. The page uses Canvas 2D and semantic HTML menus. No runtime framework, backend, API key, or account system is required for gameplay. Fonts use Google Fonts with local sans-serif fallbacks.

The npm test command runs `node --test tests.mjs`.

Generated character PNGs are included under `dist/assets/`. Built-in imagegen created both sheets; the exact prompts are recorded in `ARTWORK.md`. The returned sheets are 1254 × 1254, so the renderer uses proportional frame boundaries rather than assuming integer 256-pixel cells.

## Verification

19 automated checks cover connected maze/coins, 1–4-player setup, countdown, walls, buffered turns, deterministic movement, pause, crossing collisions, catch/coin precedence, both victory conditions, role rotation, AI navigation, PNG/settings validation, shared photo-booth publishing and quota errors, art-independent collision size, and mixed keyboard/gamepad input/disconnection conditions.

Browser QA covers lobby assignment and duplicate-control prevention, directional-sheet import, invalid-file errors, animation preview, save/reload persistence, reset, start/pause, and narrow desktop layout. Structured game-state/start/pause tools were exercised through WebMCP, including invalid inputs and invalid-state errors.

Hardware limitation: physical gamepads and separate Chrome/Edge installations were not available to the browser tools. Gamepad inputs were tested with synthetic unit-test fixtures; UI verification used the Codex in-app browser. These are not substitutes for a physical four-player compatibility/play-balance test.

## Version-one boundaries

One map; desktop keyboard/gamepad play; no GIFs, in-game AI generation, online multiplayer, touch controls, power-ups, or timer limit.
