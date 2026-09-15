# Backgammon for Meta Ray-Ban Display

A web app backgammon game built for [Meta Ray-Ban Display](https://www.meta.com/ai-glasses/) smart glasses. Play single-player against a computer opponent, controlled via the EMG Neural Band's D-pad gestures.

Built with the [Meta Wearables Web App](https://github.com/facebookincubator/meta-wearables-webapp) toolkit — vanilla HTML/CSS/JS, no dependencies, fits the 600×600 additive-display viewport.

## How to play

- **Opening roll** — Each side rolls one die; the higher die starts using both numbers. Ties reroll. Later turns use two dice, with four moves for doubles.
- **Pick a checker** — Navigate with arrow keys / Neural Band swipes. Press Enter on a point you own.
- **Move** — The selected checker has a diamond marker. Outlined destinations show the die they use. Press Enter or tap a destination. Legal choices preserve the maximum number of playable dice, including the higher-die rule.
- **Bear off** — Once all your checkers are in your home board (points 1–6), the **Bear Off** action button appears as a legal destination.
- **Undo** — Reverts the last move before you press **End Turn**. The game waits for you to confirm the turn, so a timer cannot commit it while you undo.
- **Menu** — Pause, read the three-page guide, or save and return home. This button is reachable through touch and the D-pad, including during computer turns.
- **Re-enter from bar** — If you're hit, you must enter from the bar before any other move.

Standard backgammon rules: hit a blot to send the opponent's checker to the bar; you can't land on a point with 2+ opponent checkers.

## Controls

| Input | Action |
|-------|--------|
| Arrow keys / D-pad | Move focus (spatial navigation on the board) |
| Enter / pinch | Select / activate |
| Escape | Cancel a checker selection; otherwise pause / go back |
| Touch | Tap a checker, destination or button |

Single games and matches to 2, 3 or 4 points are available. These labels reflect the existing saved match targets. A declined double awards the previous cube value, without gammon multipliers. The first round after either player reaches one point short of the target disables doubling (Crawford).

Rules reference: [U.S. Backgammon Federation — How to Play](https://usbgf.org/backgammon-basics-how-to-play/) and [tournament rules](https://usbgf.org/tournament-rules/rules-for-in-person-play/).

## Layout

- 600×600 viewport, dark theme (black = transparent on the glasses' additive display)
- Traditional 24-point board, split into 4 quadrants by the central bar
- Crafted walnut frame, brass inlay, raised ivory / jade checkers and dimensional dice; all static CSS/SVG with no rendering loop
- Header shows borne-off counts and turn status; checkmarks distinguish used dice without relying on color
- Native portrait menus and 46px action buttons on phones; the board scales to fit without cropping
- Existing `mdg_backgammon` v1/v2 saves and settings are preserved. Computer turns, cube offers, and between-round scores survive reopening

## Run locally

```bash
python -m http.server 5174
# then open http://localhost:5174
```

Arrow keys + Enter simulate the Neural Band on desktop.

## Deploy

Production: [backgammon-display.onrender.com](https://backgammon-display.onrender.com/). The existing Render Static Site deploys from `main` with no build step and the repository root as its publish directory. Existing installations use the same URL and save format. The optional staging entry in `render.yaml` is a template; it is not a provisioned service.

For installation, use the current [official Meta Wearables Web App guide](https://github.com/facebook/meta-wearables-webapp). Firmware can deliver a pinch as Enter or a click on the focused element; both work. The in-game Menu avoids relying on a system gesture to leave a game.

## Verification

Run `node --test tests/rules.cjs` for rules, legal-turn search, scoring and save compatibility checks. With the game served at `http://127.0.0.1:5202/`, run `node tests/browser.cjs` for isolated browser input, AI continuation, pause, scoring and responsive layout checks. Set `PLAYWRIGHT_MODULE` to the installed Playwright module path when needed. Tests block external requests and use disposable browser storage.

`render_game_to_text()` exposes a read-only state summary and `advanceTime(ms)` lets the web-game client wait through timed AI actions. Fixture mutation helpers exist only on `127.0.0.1` with `?test=1`.

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
