Original prompt: Substantially improve Meta Display Backgammon graphics, UI and controls; keep it lightweight for a 600×600 additive display and responsive on phones. Use a separate meta-backgammon folder and preserve existing saves. Do not deploy.

## Baseline

- Fresh clone of LiquidAzir/backgammon-display at 20d8467, September 15, 2026. No AGENTS.md exists in this repository. The existing backgammon folder is untouched.
- Vanilla DOM/CSS/JS game, no external libraries or backend. Review covers rules, save/continue, AI transitions, focus, touch, and board readability.
- Evidence and isolated preview server are outside this repository in .visual-review/tabletop/backgammon/; port 5202.

## Direction

- A crafted walnut frame, ink leather playing surface, brass inlay, ivory and teal checkers with visible thickness, readable dice and distinct move/turn indicators.
- Preserve the existing save key and game-state format; add targeted rule and control regressions for confirmed defects.

## Completed — 2026-09-15

- Static walnut, brass and woven green board; numbered points, raised ivory/jade checkers, engraved rings, clear stack counts and dimensional dice. Original SVG miniature board for the title screen; no runtime dependencies, fonts, network assets or render loop.
- Native portrait phone menus and action buttons; only the board scales. Fixed mobile innerWidth inflation using document client bounds. 600×600 layout retains 8px margins and black surround.
- D-pad/touch Menu, pause/resume/save-and-home, three-page guide, selection cancel, coordinate-free focused click, preserved focus and non-color-only dice/selection cues. Escape cancels selection or pauses. Match choices show actual point targets.
- Rules: opening roll/tie handling, maximum dice usage with memoized continuation search, higher-die obligation, explicit End Turn and safe Undo, correct declined-cube scoring, first one-away Crawford round.
- Save/flow: resume computer turns and both cube offers, save committed moves and round results, preserve v1/v2 keys, cancel stale AI timers, pause AI actions, ignore animation input, prevent skipping playable dice. Save validation rejects impossible checker totals and dice.

## Verification

- `node --test tests/rules.cjs`: 16/16 passing. Includes all36 starting rolls, doubles, bar priority, hits, bearing off, gammon scoring, cube/Crawford and v1/v2 save compatibility. All36 starting legal searches take about5ms total on this host.
- `node tests/browser.cjs`: 29/29 passing, external network blocked, disposable saves, explicit SwiftShader. Ten setup controls, focused click pinch, keyboard/touch, Menu, undo timing, AI pause/reload, both cube offers, old-value drop scoring, round-result reload, Crawford, opening tie, 600/1200 layout and actual320/390 mobile contexts.
- Mandatory skill client passed; screenshot/state inspected at `.visual-review/tabletop/backgammon/skill-client/`.
- Final home/setup/board/selected/pause/all-help screenshots at600 and actual390 phone inspected in `.visual-review/tabletop/backgammon/after/`. Original before captures preserved.
- `git diff --check` passes. Root independently verified original version2 save and glasses-style focused element activation.
- No push/deploy. Existing sibling backgammon untouched. Preview remains at5202.

## Notes for next reviewer

- Old1/2/3/4 victory targets retained, relabeled truthfully instead of Best of3/5/7.
- Undo remains available until explicit End Turn; computer turns continue automatically.
- Actual glasses hardware testing remains for perceived brightness and firmware input behavior. Browser checks cover documented Enter and focused-click events.

2026-09-15 production release: user approved publishing this reviewed overhaul to the existing Render service. Release preflight confirmed the Meta repository, unchanged remote main, runtime dependencies, save compatibility and display/phone checks. Production asset cache headers now require revalidation. Live deployment results are recorded in the workspace tabletop/release evidence after publication.
