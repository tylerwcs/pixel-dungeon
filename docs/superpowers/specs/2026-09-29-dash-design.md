# Dash — design

Date: 2026-09-29
Status: approved in chat, awaiting spec review

## Goal

Give players one button-triggered ability — a short speed burst — that uses the gamepads' face buttons without changing what the game is: one collector, three pursuers, one maze, four rounds.

## Rules

| | Collector | Pursuer |
|---|---|---|
| Availability | Any time, 8 s cooldown | Once per round |
| Effect | Burst to ×3.5 speed, easing back to ×1 over 0.7 s (peak 15.75 tiles/s) | Burst to ×3.5 speed, easing back to ×1 over 0.7 s (peak 13.3 tiles/s) |

- The cooldown starts when the dash ends, not when it is triggered.
- No dashing during the countdown. A request during the countdown is ignored, not queued.
- A request while already dashing, recharging, or spent is ignored.
- Everything resets at the start of each round (`newRound`): collector ready, each pursuer has 1 dash. This holds when the collector role rotates.
- Catching is unchanged. `sweptContact` already tests the swept segment, so higher speed cannot skip past a catch. Coin pickup still works: at the 15.75 tiles/s peak the collector moves 0.26 tiles per 1/60 s step, inside the 0.44-tile pickup window. The burst covers about the same extra distance as the original ×1.6-for-1.5 s dash.
- Character artwork never affects dash or collision.

## Controls

- Gamepad: any face button, indices 0–3. These pads report no standard mapping, so "A" cannot be identified reliably. Any face button avoids guessing and is easy to explain.
- Keyboard: `Q` for the WASD player; `/` for the arrow-keys player.
- A held button triggers one dash. It must be released and pressed again to request another dash (edge-triggered), so a held button doesn't re-fire the moment the collector's cooldown ends.
- Right Shift was dropped: pressing Shift five times opens the Windows Sticky Keys prompt, which would pause a live round.

## AI

Deterministic rules, evaluated each step while `playing`:

- AI collector: dashes when any pursuer is within 3 tiles (Manhattan distance on rounded positions) and its dash is ready.
- AI pursuer: uses its one dash when within 5 tiles of the collector along a straight, wall-free row or column.

## Engine (`engine.mjs`)

Per actor, added in `newRound`:

- `dashTime` — seconds of boost left (0 when not dashing)
- `dashCooldown` — collector only: seconds until ready
- `dashesLeft` — pursuers: 1 at round start; unused for the collector
- `dashRequested` — set by input or AI, consumed by `step`

A pure `dashReady(actor)` helper is used by `step`, the AI and the HUD.

In `step`, while `playing` and before movement:

1. Apply AI dash decisions for non-human actors.
2. For each actor with `dashRequested` and `dashReady`, start a dash (`dashTime = DASH_TIME` = 0.7; pursuers `dashesLeft -= 1`).
3. Clear `dashRequested`.
4. Movement uses `speed * dashSpeedFactor(actor)`, where `dashSpeedFactor = 1 + (DASH_BOOST − 1) × dashTime / DASH_TIME` (DASH_BOOST = 3.5) while dashing, else 1.
5. Tick `dashTime` down. When it reaches 0 on the collector, set `dashCooldown = 8`. Tick `dashCooldown` down.

`step` returns a `'dash'` event when a dash starts, for a sound cue. Everything stays on the fixed 1/60 s step with no randomness.

## Input (`input.mjs`)

- `gamepadDash(g)` — true when any of buttons 0–3 is pressed.
- `app.mjs` tracks the previous pressed state per pad; keyboard uses `keydown` with `!event.repeat`. It sets `actor.dashRequested = true` only on the transition from not-pressed to pressed.

## Display

- Player panel: a new dash line in each in-game HUD card, below the name and role:
  - Collector: `⚡ DASH` when ready, a filling bar while recharging, a glow while dashing.
  - Pursuer: `⚡ DASH ×1`, then `USED`.
- Maze: `render.mjs` draws, under the live sprites, up to six fading afterimages of the dashing character's own sprite tinted in the player's colour (sampled over the last 0.3 s), and a 0.35 s ring-and-dust puff where the dash began. Drawing only: sprite and collision sizes are unchanged. (This replaced an earlier square trail drawn by `app.mjs`; the `render.mjs` change bumps its `?v=` tag chain.)
- Sound: a short band-passed noise whoosh on `'dash'`, respecting mute.
- Help dialog: one line on the dash and its keys.

## Project rules

`AGENTS.md` "Product boundaries" currently lists power-ups as out of scope. Change it to: dash (as specified here) is in scope; other power-ups remain out of scope.

## Cache tags

Bump `app.mjs`, `input.mjs` and `style.css` to `?v=dash-1` and update the matching assertions in `tests.mjs`. `engine.mjs` and `labels.mjs` stay untagged: they have never had a tag, all their importers use the plain path, and every `.mjs` is served `no-cache`. Tagging them now would force a tag chain through `render.mjs` and the join, pass and character pages.

## Testing

`tests.mjs`:

- A dash moves an actor DASH_BOOST× as far on its first step, and the speed factor eases back towards 1.
- Collector cooldown: no second dash until 0.7 s + 8 s after the first.
- A pursuer dashes once; a second request in the same round is ignored.
- `newRound` resets dash state, including after the collector role rotates.
- A request during the countdown is ignored.
- A pursuer dashing through the collector's path still registers a catch.
- AI collector dashes when a pursuer is within 3 tiles; AI pursuer dashes with a clear straight line within 5 tiles and not through a wall.
- `gamepadDash` detects buttons 0–3 and ignores 8/9 (Select/Start).
- Updated source-text and `?v=` assertions.

Also: `npm run test:browser`, a desktop and narrow-width check of the panels, and a live check with the 4 pads.

## Out of scope

The other abilities discussed (Freeze Burst, Snare, Blink, Radar), a B-button ability, per-character abilities, and pickups.
