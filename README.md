# Backgammon for Meta Ray-Ban Display

A web app backgammon game built for [Meta Ray-Ban Display](https://www.meta.com/ai-glasses/) smart glasses. Play single-player against a computer opponent, controlled via the EMG Neural Band's D-pad gestures.

Built with the [Meta Wearables Web App](https://github.com/facebookincubator/meta-wearables-webapp) toolkit — vanilla HTML/CSS/JS, no dependencies, fits the 600×600 additive-display viewport.

## How to play

- **Roll** — Press the Roll button (Enter / pinch). Doubles award 4 moves of the same value.
- **Pick a checker** — Navigate with arrow keys / Neural Band swipes. Press Enter on a point you own.
- **Move** — Legal destinations pulse emerald; the selected checker glows amber. Press Enter on a destination.
- **Bear off** — Once all your checkers are in your home board (points 1–6), the **Bear Off** action button appears as a legal destination.
- **Undo** — Reverts the last move within your turn.
- **Re-enter from bar** — If you're hit, you must enter from the bar before any other move.

Standard backgammon rules: hit a blot to send the opponent's checker to the bar; you can't land on a point with 2+ opponent checkers.

## Controls

| Input | Action |
|-------|--------|
| Arrow keys / D-pad | Move focus (spatial navigation on the board) |
| Enter / pinch | Select / activate |
| Escape | Back (only outside of an active game) |

## Layout

- 600×600 viewport, dark theme (black = transparent on the glasses' additive display)
- Traditional 24-point board, split into 4 quadrants by the central bar
- Two-tone amber / teal triangles, cream / charcoal checkers
- Header shows remaining-piece counts and turn status
- Action panel shows dice + context-aware buttons (Roll, Undo, End Turn, Bear Off)

## Run locally

```bash
python -m http.server 5174
# then open http://localhost:5174
```

Arrow keys + Enter simulate the Neural Band on desktop.

## Deploy

Hosted as a static site — any HTTPS host works. Configured for [Render](https://render.com) via `render.yaml` with two environments:

| Branch | Render service | URL |
|--------|---------------|-----|
| `main` | `backgammon-display` | https://backgammon-display.onrender.com |
| `staging` | `backgammon-display-staging` | https://backgammon-display-staging.onrender.com |

Workflow:

1. Develop on a feature branch
2. Merge to `staging` first — Render auto-deploys to the staging URL. Verify on-device.
3. When happy, merge `staging` → `main` to ship to production.

Once live, add the production URL to the glasses via the Meta AI app → Devices → Display Glasses → App connections → Web apps.

## Files

```
index.html           Game screens (home, game, gameover)
styles.css           Dark theme, board, points, checkers, dice
app.js               Game engine, D-pad navigation, greedy AI
favicon.png          App icon (two points + two checkers)
manifest.webmanifest Web App Manifest
render.yaml          Render static site config
```

## AI

Greedy, single-ply heuristic. Each candidate move is scored:

- **+110** for bearing off (penalized if the die overshoots)
- **+90** for hitting an opponent blot (extra +25 deep in their home board)
- **+28** for landing on an existing own point (+18 if making a point from a blot)
- **−penalty** proportional to blot vulnerability at the destination
- **+0.6 × distance** to advance the rear-most checker
- **−18** for breaking an existing own point into a blot
- **+70** for any move that gets a checker off the bar

Best score wins each die. Plays moves one at a time with animation delays so the player can follow what's happening.
