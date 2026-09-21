# Pixel Dungeon Chase

## Project overview

This repository contains a browser-only local multiplayer game. The complete static application lives in `dist/`; there is no framework build step or backend.

## Important files

- `dist/index.html` — page structure and menus
- `dist/app.mjs` — application state and lobby/round flow
- `dist/engine.mjs` — fixed-step simulation, maze, AI and collisions
- `dist/render.mjs` — Canvas 2D drawing and sprite animation
- `dist/input.mjs` — keyboard and gamepad normalization
- `dist/characters.mjs` — PNG import, preview and IndexedDB persistence
- `dist/style.css` — layout and visual styling
- `tests.mjs` — Node-based engine and behavior tests
- `.openai/hosting.json` — existing Sites deployment configuration

## Commands

- `npm run dev` starts the local site at `http://127.0.0.1:4173`.
- `npm test` runs the automated test suite.

## Development rules

- Keep the game dependency-free unless a feature clearly requires a package.
- Preserve the static `dist/` deployment layout because Sites serves that directory directly.
- Keep simulation behavior deterministic and use the existing fixed timestep.
- Imported artwork must never affect collision size.
- Maintain the sprite-sheet row order: down, left, right, up.
- Run `npm test` after changes to game logic, input, character import or round flow.
- When changing visual behavior, verify the lobby and gameplay in a browser at desktop and narrow widths.

## Version-one boundaries

The current product supports desktop keyboard/gamepad play, one maze and local multiplayer only. It intentionally excludes online multiplayer, touch controls, GIF import, power-ups and a round timer.
