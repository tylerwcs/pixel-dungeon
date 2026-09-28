# Dash — design

Date: 2026-09-29
Status: approved in chat, awaiting spec review

## Goal

Give players one button-triggered ability — a short speed burst — that uses the gamepads' face buttons without changing what the game is: one collector, three pursuers, one maze, four rounds.

## Rules

| | Collector | Pursuer |
|---|---|---|
| Availability | Any time, 8 s cooldown | Once per round |
| Effect | +60% speed for 1.5 s (4.5 → 7.2 tiles/s) | +60% speed for 1.5 s (3.8 → 6.1 tiles/s) |

- The cooldown starts when the dash ends, not when it is triggered.
- No dashing during the countdown. A request during the countdown is ignored, not queued.
- A request while already dashing, recharging, or spent is ignored.
- Everything resets at the start of each round (`newRound`): collector ready, each pursuer has 1 dash. This holds when the collector role rotates.
- Catching is unchanged. `sweptContact` already tests the swept segment, so higher speed cannot skip past a catch. Coin pickup still works: at 7.2 tiles/s the collector moves 0.12 tiles per 1/60 s step, well inside the 0.44-tile pickup window.
- Character artwork never affects dash or collision.

## Controls

- Gamepad: any face button, indices 0–3. These pads report no standard mapping, so "A" cannot be identified reliably. Any face button avoids guessing and is easy to explain.
- Keyboard: `Q` for the WASD player; `/` or `Right Shift` for the arrow-keys player.
- A held button triggers one dash. It must be released and pressed again to request another dash (edge-triggered), so a held button doesn't re-fire the moment the collector's cooldown ends.

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
2. For each actor with `dashRequested` and `dashReady`, start a dash (`dashTime = 1.5`; pursuers `dashesLeft -= 1`).
3. Clear `dashRequested`.
4. Movement uses `speed * (dashTime > 0 ? 1.6 : 1)`.
5. Tick `dashTime` down. When it reaches 0 on the collector, set `dashCooldown = 8`. Tick `dashCooldown` down.

`step` returns a `'dash'` event when a dash starts, for a sound cue. Everything stays on the fixed 1/60 s step with no randomness.

## Input (`input.mjs`)

- `gamepadDash(g)` — true when any of buttons 0–3 is pressed.
- `app.mjs` tracks the previous pressed state per pad; keyboard uses `keydown` with `!event.repeat`. It sets `actor.dashRequested = true` only on the transition from not-pressed to pressed.

## Display

- Player panel: a new dash line in each in-game HUD card, below the name and role:
  - Collector: `⚡ DASH` when ready, a filling bar while recharging, a glow while dashing.
  - Pursuer: `⚡ DASH ×1`, then `USED`.
- Maze: a dashing character gets a short fading trail of its earlier positions in the player's colour, drawn by `app.mjs` right after the renderer (so `render.mjs` and its tagged importers don't change). The two most recent positions are skipped so the trail doesn't cover the sprite. Sprite and collision sizes are unchanged.
- Sound: a short rising blip on `'dash'`, respecting mute.
- Help dialog: one line on the dash and its keys.

## Project rules

`AGENTS.md` "Product boundaries" currently lists power-ups as out of scope. Change it to: dash (as specified here) is in scope; other power-ups remain out of scope.

## Cache tags

Bump `app.mjs`, `input.mjs` and `style.css` to `?v=dash-1` and update the matching assertions in `tests.mjs`. `engine.mjs` and `labels.mjs` stay untagged: they have never had a tag, all their importers use the plain path, and every `.mjs` is served `no-cache`. Tagging them now would force a tag chain through `render.mjs` and the join, pass and character pages.

## Testing

`tests.mjs`:

- A dashing actor covers 1.6× the distance of a non-dashing one over the same steps.
- Collector cooldown: no second dash until 1.5 s + 8 s after the first.
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
