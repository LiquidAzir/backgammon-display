(function () {
  'use strict';

  // =================== CONSTANTS ===================
  var COLOR_W = 'w';
  var COLOR_B = 'b';
  var MAX_VISIBLE_CHECKERS = 5;
  var AI_ROLL_DELAY = 600;
  var AI_SELECT_DELAY = 550;
  var AI_MOVE_DELAY = 500;
  var END_TURN_DELAY = 700;
  var STORAGE_KEY = 'mdg_backgammon';
  var SETTINGS_KEY = 'mdg_backgammon_settings';
  var DEFAULT_SETTINGS = { difficulty: 'normal', soundOn: true };

  // =================== STATE ===================
  var state = {
    currentScreen: 'home',
    screenHistory: [],
    game: null,
    match: null,
    snapshot: null,
    aiBusy: false,
    animating: false,
    settings: null,  // loaded from localStorage on init
  };

  var screens = {};
  var flowEpoch = 0, deferred = [], helpReturn = 'home', helpPage = 0;
  var appScale = 1;
  function fit() {
    var width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    appScale = Math.min(width / 600, height / 600, 1.5);
    document.documentElement.style.setProperty('--scale', appScale);
    document.documentElement.style.setProperty('--board-scale', Math.min(1, (width - 16) / 584));
    if (width < 600 && height > width) appScale = Math.min(1, (width - 16) / 584);
  }
  function cancelFlow() { flowEpoch++; deferred = []; state.animating = false; }
  function later(fn, ms) {
    var epoch = flowEpoch;
    setTimeout(function () {
      if (epoch !== flowEpoch) return;
      if (state.currentScreen !== 'game') { deferred.push(fn); return; }
      fn();
    }, ms);
  }
  function pauseGame() {
    if (!state.game || state.currentScreen !== 'game') return;
    saveGame();
    navigateTo('pause', { addToHistory: false });
  }
  function resumeGame() {
    navigateTo('game', { addToHistory: false });
    renderGame();
    var waiting = deferred.splice(0);
    waiting.forEach(function (fn) { later(fn, 40); });
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var s = raw ? JSON.parse(raw) : {};
      return {
        difficulty: ['easy', 'normal', 'hard'].indexOf(s.difficulty) >= 0
                    ? s.difficulty : DEFAULT_SETTINGS.difficulty,
        soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : DEFAULT_SETTINGS.soundOn,
      };
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (e) {}
  }

  function getDifficulty() {
    // Mid-match difficulty wins over the global setting so a resumed match
    // keeps the level it was started at.
    if (state.match && state.match.difficulty) return state.match.difficulty;
    return (state.settings && state.settings.difficulty) || 'normal';
  }

  function newMatchState(length, difficulty) {
    // length is the "best of N" games — match is decided when a player
    // reaches ceil(N/2) match points (cube value × game wins).
    var target = Math.max(1, Math.ceil(length / 2));
    return {
      length: length,
      target: target,
      difficulty: difficulty || (state.settings && state.settings.difficulty) || 'normal',
      scoreW: 0,
      scoreB: 0,
      gameNumber: 1,
      crawfordPlayed: false,
    };
  }

  // =================== GAME MODEL ===================
  function createInitialBoard() {
    var b = new Array(24).fill(null);
    b[0]  = { color: COLOR_B, count: 2 };
    b[5]  = { color: COLOR_W, count: 5 };
    b[7]  = { color: COLOR_W, count: 3 };
    b[11] = { color: COLOR_B, count: 5 };
    b[12] = { color: COLOR_W, count: 5 };
    b[16] = { color: COLOR_B, count: 3 };
    b[18] = { color: COLOR_B, count: 5 };
    b[23] = { color: COLOR_W, count: 2 };
    return b;
  }

  function newGameState() {
    return {
      board: createInitialBoard(),
      bar: { w: 0, b: 0 },
      off: { w: 0, b: 0 },
      turn: COLOR_W,
      diceRolled: [],
      diceRemaining: [],
      diceUsed: [],
      selected: null,
      legalDests: [],
      phase: 'need-roll',
      winner: null,
      opening: true,
      // Doubling cube. owner === null means centered (either player can offer).
      cube: { value: 1, owner: null },
      // While a double is being negotiated.
      cubeOffer: null,  // null OR { by: 'w'|'b', value: <new value> }
    };
  }

  function deepClone(g) {
    return JSON.parse(JSON.stringify(g));
  }

  // =================== PERSISTENCE ===================
  // Save each committed board mutation. Continue resumes computer turns and
  // cube offers; saved round results preserve match points until Next game.
  function saveGame() {
    if (!state.game) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        game: state.game,
        match: state.match,
      }));
    } catch (e) {
      // quota or disabled — silently ignore
    }
  }

  function loadSavedGame() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var g, m;
      if (parsed && parsed.version === 2 && parsed.game) {
        g = parsed.game;
        m = parsed.match || newMatchState(1);
      } else {
        // v1 save (no envelope, no match/cube) — migrate.
        g = parsed;
        m = newMatchState(1);
      }
      if (!g || !Array.isArray(g.board) || g.board.length !== 24) return null;
      function count(n) { return Number.isInteger(n) && n >= 0 && n <= 15; }
      if (!g.bar || !g.off || !['w','b'].includes(g.turn) || !['need-roll','need-move','gameover'].includes(g.phase)) return null;
      if (!g.board.every(function(c) { return c === null || (['w','b'].includes(c.color) && count(c.count) && c.count > 0); })) return null;
      if (!['w','b'].every(function(c) { return count(g.bar[c]) && count(g.off[c]) && g.board.reduce(function(n,p) { return n + (p && p.color === c ? p.count : 0); }, g.bar[c] + g.off[c]) === 15; })) return null;
      if (!['diceRolled','diceRemaining'].every(function(k) { return Array.isArray(g[k]) && g[k].length <= 4 && g[k].every(function(d) { return Number.isInteger(d) && d >= 1 && d <= 6; }); }) || !Array.isArray(g.diceUsed)) return null;
      if (!m || !Number.isFinite(m.target) || m.target < 1 || !Number.isFinite(m.scoreW) || !Number.isFinite(m.scoreB)) return null;
      // Backfill cube fields if loading from older save shape.
      if (!g.cube) g.cube = { value: 1, owner: null };
      if (g.cubeOffer === undefined) g.cubeOffer = null;
      // Never trust cached destinations from an older implementation.
      g.selected = null;
      g.legalDests = [];
      return { game: g, match: m };
    } catch (e) {
      return null;
    }
  }

  function clearSavedGame() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function updateHomeButtons() {
    var saved = loadSavedGame();
    var contBtn = document.getElementById('continue-btn');
    var playBtn = document.getElementById('play-btn');
    if (!contBtn || !playBtn) return;
    if (saved) {
      contBtn.classList.remove('hidden');
      playBtn.classList.remove('primary-btn');
      playBtn.classList.add('secondary-btn');
      playBtn.textContent = 'New Game';
    } else {
      contBtn.classList.add('hidden');
      playBtn.classList.remove('secondary-btn');
      playBtn.classList.add('primary-btn');
      playBtn.textContent = 'Play';
    }
  }

  // =================== RULES ===================
  function direction(color) { return color === COLOR_W ? -1 : 1; }

  function homeRange(color) {
    return color === COLOR_W ? { lo: 0, hi: 5 } : { lo: 18, hi: 23 };
  }

  function entryPoint(color, die) {
    return color === COLOR_W ? 24 - die : die - 1;
  }

  function allInHome(g, color) {
    if (g.bar[color] > 0) return false;
    var r = homeRange(color);
    for (var i = 0; i < 24; i++) {
      if (g.board[i] && g.board[i].color === color) {
        if (i < r.lo || i > r.hi) return false;
      }
    }
    return true;
  }

  function canLand(g, point, color) {
    if (point < 0 || point > 23) return false;
    var c = g.board[point];
    if (!c) return true;
    if (c.color === color) return true;
    return c.count === 1; // hit a blot
  }

  function bearOffDistance(color, point) {
    return color === COLOR_W ? point + 1 : 24 - point;
  }

  function canBearOffFrom(g, color, fromPoint, die) {
    if (!allInHome(g, color)) return false;
    var dist = bearOffDistance(color, fromPoint);
    if (die === dist) return true;
    if (die < dist) return false;
    // Overshoot: only if no checker is further from home
    var r = homeRange(color);
    if (color === COLOR_W) {
      for (var i = fromPoint + 1; i <= r.hi; i++) {
        if (g.board[i] && g.board[i].color === color) return false;
      }
    } else {
      for (var i = fromPoint - 1; i >= r.lo; i--) {
        if (g.board[i] && g.board[i].color === color) return false;
      }
    }
    return true;
  }

  function rawMovesForSelection(g, source) {
    var color = g.turn;
    var moves = [];
    var dir = direction(color);
    var seen = {};

    if (g.bar[color] > 0 && source !== 'bar') return moves;

    g.diceRemaining.forEach(function (d, i) {
      if (seen[d]) return;
      if (source === 'bar') {
        var ep = entryPoint(color, d);
        if (canLand(g, ep, color)) {
          moves.push({ from: 'bar', to: ep, die: d, dieIdx: i });
          seen[d] = true;
        }
      } else {
        var cell = g.board[source];
        if (!cell || cell.color !== color) return;
        var to = source + dir * d;
        if (to >= 0 && to <= 23) {
          if (canLand(g, to, color)) {
            moves.push({ from: source, to: to, die: d, dieIdx: i });
            seen[d] = true;
          }
        } else {
          if (canBearOffFrom(g, color, source, d)) {
            moves.push({ from: source, to: 'off', die: d, dieIdx: i });
            seen[d] = true;
          }
        }
      }
    });
    return moves;
  }

  function rawLegalMoves(g) {
    var color = g.turn;
    var sources = [];
    if (g.bar[color] > 0) {
      sources = ['bar'];
    } else {
      for (var i = 0; i < 24; i++) {
        if (g.board[i] && g.board[i].color === color) sources.push(i);
      }
    }
    var moves = [];
    sources.forEach(function (src) {
      rawMovesForSelection(g, src).forEach(function (m) { moves.push(m); });
    });
    return moves;
  }

  var legalCache = new WeakMap();
  function positionKey(g) {
    return g.turn + ':' + g.board.map(function(c) { return c ? c.color + c.count : '-'; }).join(',') +
      ':' + g.bar.w + ',' + g.bar.b + ':' + g.off.w + ',' + g.off.b + ':' + g.diceRemaining.join(',');
  }
  function allLegalMoves(g) {
    var key = positionKey(g), cached = legalCache.get(g);
    if (cached && cached.key === key) return cached.moves;
    var memo = new Map();
    function lengthAfter(position) {
      if (!position.diceRemaining.length) return 0;
      var k = positionKey(position);
      if (memo.has(k)) return memo.get(k);
      var moves = rawLegalMoves(position), best = 0;
      for (var i = 0; i < moves.length; i++) {
        var next = deepClone(position); makeMove(next, moves[i]);
        best = Math.max(best, 1 + lengthAfter(next));
        if (best === position.diceRemaining.length) break;
      }
      memo.set(k, best); return best;
    }
    var candidates = rawLegalMoves(g), best = 0;
    var scores = candidates.map(function(m) {
      var next = deepClone(g); makeMove(next, m);
      var n = 1 + lengthAfter(next); best = Math.max(best, n); return n;
    });
    var moves = candidates.filter(function(m,i) { return scores[i] === best; });
    // When only one of two different dice can be played, use the higher.
    if (best === 1 && g.diceRemaining.length === 2 && g.diceRemaining[0] !== g.diceRemaining[1]) {
      var high = Math.max.apply(null, moves.map(function(m) { return m.die; }));
      moves = moves.filter(function(m) { return m.die === high; });
    }
    legalCache.set(g, { key: key, moves: moves }); return moves;
  }
  function legalMovesForSelection(g, source) {
    return allLegalMoves(g).filter(function(m) { return m.from === source; });
  }

  function makeMove(g, move) {
    var color = g.turn;
    if (move.from === 'bar') {
      g.bar[color]--;
    } else {
      g.board[move.from].count--;
      if (g.board[move.from].count === 0) g.board[move.from] = null;
    }
    if (move.to === 'off') {
      g.off[color]++;
    } else {
      var dest = g.board[move.to];
      if (dest && dest.color !== color) {
        g.bar[dest.color]++;
        g.board[move.to] = { color: color, count: 1 };
      } else if (dest) {
        dest.count++;
      } else {
        g.board[move.to] = { color: color, count: 1 };
      }
    }
    // Remove the used die from remaining
    g.diceRemaining.splice(move.dieIdx, 1);
    // Mark one matching unused die as used for display
    for (var i = 0; i < g.diceRolled.length; i++) {
      if (!g.diceUsed[i] && g.diceRolled[i] === move.die) {
        g.diceUsed[i] = true;
        break;
      }
    }
  }

  function gameWinner(g) {
    if (g.off.w === 15) return COLOR_W;
    if (g.off.b === 15) return COLOR_B;
    return null;
  }

  // Standard rules:
  //   1 — normal win (loser has borne off >= 1 checker)
  //   2 — gammon  (loser has borne off zero)
  //   3 — backgammon (loser has borne off zero AND has a checker on the
  //                   bar OR a checker in the winner's home board)
  function gameWinMultiplier(g, winnerColor) {
    var loser = winnerColor === COLOR_W ? COLOR_B : COLOR_W;
    if (g.off[loser] > 0) return 1;
    if (g.bar[loser] > 0) return 3;
    var lo = winnerColor === COLOR_W ? 0 : 18;
    var hi = winnerColor === COLOR_W ? 5 : 23;
    for (var i = lo; i <= hi; i++) {
      if (g.board[i] && g.board[i].color === loser) return 3;
    }
    return 2;
  }

  function pipCount(g, color) {
    // Sum of pip-distances all of `color`'s checkers still need to bear off.
    // Lower = better position. Used by the AI for cube decisions.
    var n = 0;
    n += g.bar[color] * (color === COLOR_W ? 25 : 25); // bar = 25 pips
    for (var i = 0; i < 24; i++) {
      var c = g.board[i];
      if (c && c.color === color) {
        n += c.count * bearOffDistance(color, i);
      }
    }
    return n;
  }

  function canOfferDouble(g, color) {
    if (g.opening || g.crawford) return false;
    // Standard rule: cube can only be offered at the start of your turn,
    // before rolling. The cube must be centered or owned by you.
    if (g.winner) return false;
    if (g.cubeOffer) return false;
    if (g.turn !== color) return false;
    if (g.phase !== 'need-roll') return false;
    if (g.cube.value >= 64) return false;
    if (g.cube.owner !== null && g.cube.owner !== color) return false;
    return true;
  }

  // =================== AI ===================
  function blotVulnerability(g, point, color) {
    var opp = color === COLOR_W ? COLOR_B : COLOR_W;
    var oppDir = direction(opp);
    var penalty = 0;
    for (var d = 1; d <= 6; d++) {
      var attacker = point - oppDir * d;
      if (attacker < 0 || attacker > 23) continue;
      var c = g.board[attacker];
      if (c && c.color === opp) penalty += 5;
    }
    if (g.bar[opp] > 0) {
      for (var d2 = 1; d2 <= 6; d2++) {
        var entry = entryPoint(opp, d2);
        if (Math.abs(entry - point) <= 6) penalty += 3;
      }
    }
    return penalty;
  }

  function aiScoreMove(g, move) {
    var color = g.turn;
    var score = 0;
    var dest = move.to;

    if (dest === 'off') {
      score += 110;
      var dist = bearOffDistance(color, move.from);
      score -= (move.die - dist) * 3;
      return score;
    }

    var destCell = g.board[dest];

    if (destCell && destCell.color !== color && destCell.count === 1) {
      score += 90;
      if (color === COLOR_W && dest >= 18) score += 25;
      if (color === COLOR_B && dest <= 5) score += 25;
    }

    if (destCell && destCell.color === color) {
      score += 28;
      if (destCell.count === 1) score += 18;
    } else {
      score -= blotVulnerability(g, dest, color);
    }

    // Prefer advancing the rear-most checker (white rear = high idx, black rear = low idx)
    var from = move.from === 'bar' ? (color === COLOR_W ? 24 : -1) : move.from;
    if (color === COLOR_W) score += from * 0.6;
    else score += (23 - from) * 0.6;

    if (move.from !== 'bar') {
      var src = g.board[move.from];
      if (src && src.count === 2) score -= 18;
    }

    if (move.from === 'bar') score += 70;

    return score;
  }

  function greedyBestMove(g, moves) {
    var best = moves[0];
    var bestScore = aiScoreMove(g, moves[0]);
    for (var i = 1; i < moves.length; i++) {
      var s = aiScoreMove(g, moves[i]);
      if (s > bestScore) { bestScore = s; best = moves[i]; }
    }
    return best;
  }

  // For each candidate FIRST move, simulate playing the rest of the dice
  // greedily, and pick the first move that yields the highest total score.
  // This is a 1-step lookahead — modest cost, meaningful strength bump.
  function hardBestMove(g) {
    var firstMoves = allLegalMoves(g);
    if (firstMoves.length === 0) return null;
    if (firstMoves.length === 1) return firstMoves[0];

    var best = firstMoves[0];
    var bestScore = -Infinity;

    for (var i = 0; i < firstMoves.length; i++) {
      var move = firstMoves[i];
      var sim = deepClone(g);
      var score = aiScoreMove(sim, move);
      makeMove(sim, move);
      // Greedy-simulate remaining dice.
      var guard = 6;  // sanity cap (max 4 doubles)
      while (sim.diceRemaining.length > 0 && guard-- > 0) {
        var simMoves = allLegalMoves(sim);
        if (simMoves.length === 0) break;
        var step = greedyBestMove(sim, simMoves);
        score += aiScoreMove(sim, step);
        makeMove(sim, step);
      }
      if (score > bestScore) { bestScore = score; best = move; }
    }
    return best;
  }

  function aiPickBestMove(g) {
    var moves = allLegalMoves(g);
    if (moves.length === 0) return null;
    var diff = getDifficulty();
    if (diff === 'easy') {
      // Random legal move. Predictable weakness — easy to beat.
      return moves[Math.floor(Math.random() * moves.length)];
    }
    if (diff === 'hard') {
      return hardBestMove(g);
    }
    return greedyBestMove(g, moves);
  }

  // ---------- Cube AI ----------
  function aiShouldOfferDouble(g) {
    if (!canOfferDouble(g, COLOR_B)) return false;
    var diff = getDifficulty();
    if (diff === 'easy') return false;  // easy AI never doubles
    var myPips = pipCount(g, COLOR_B);
    var theirPips = pipCount(g, COLOR_W);
    var pipDiff = theirPips - myPips;   // positive = we're ahead
    // Hard plays the cube more aggressively (lower threshold to offer,
    // willing to push to higher cube values).
    var threshold = diff === 'hard' ? 14 : 20;
    var bigCubeThreshold8 = diff === 'hard' ? 25 : 35;
    var bigCubeThreshold16 = diff === 'hard' ? 40 : 50;
    if (g.cube.value >= 16 && pipDiff < bigCubeThreshold16) return false;
    if (g.cube.value >= 8  && pipDiff < bigCubeThreshold8) return false;
    return pipDiff >= threshold;
  }

  function aiShouldAcceptDouble(g) {
    var diff = getDifficulty();
    if (diff === 'easy') return true;  // easy AI always accepts (over-takes)
    var myPips = pipCount(g, COLOR_B);
    var theirPips = pipCount(g, COLOR_W);
    var pipDiff = myPips - theirPips;  // positive = we're behind
    var newValue = g.cubeOffer ? g.cubeOffer.value : g.cube.value * 2;
    // Hard drops earlier when clearly losing (preserves match equity).
    var bigDropThreshold = diff === 'hard' ? 30 : 40;
    var hardDropThreshold = diff === 'hard' ? 55 : 70;
    if (pipDiff > bigDropThreshold && newValue >= 4) return false;
    if (pipDiff > hardDropThreshold) return false;
    return true;
  }

  // =================== RENDERING ===================
  function isFocusableSource(g, idx) {
    if (g.turn !== COLOR_W) return false;
    if (g.phase !== 'need-move') return false;
    if (g.selected !== null) return false;
    if (g.bar.w > 0) return false;
    var cell = g.board[idx];
    if (!cell || cell.color !== COLOR_W) return false;
    return legalMovesForSelection(g, idx).length > 0;
  }

  function isFocusableBar(g) {
    if (g.turn !== COLOR_W) return false;
    if (g.phase !== 'need-move') return false;
    if (g.bar.w === 0) return false;
    if (g.selected !== null && g.selected !== 'bar') return false;
    return legalMovesForSelection(g, 'bar').length > 0;
  }

  function isDestPoint(g, idx) {
    if (g.selected === null) return false;
    return g.legalDests.some(function (m) { return m.to === idx; });
  }

  function buildPointHTML(idx, isTop, col) {
    var g = state.game;
    var cell = g.board[idx];
    var lightCol = isTop ? (col % 2 === 0) : (col % 2 === 1);

    var classes = ['point', isTop ? 'top' : 'bot', lightCol ? 'light' : 'dark'];
    var canFocus = !state.aiBusy && !state.animating && (isFocusableSource(g, idx) || isDestPoint(g, idx) || (g.selected === idx));
    if (canFocus) classes.push('focusable');
    if (g.selected === idx) classes.push('selected');
    if (isDestPoint(g, idx)) classes.push('dest');

    var desc = 'Point ' + (idx + 1) + (cell ? ', ' + cell.count + (cell.color === COLOR_W ? ' ivory' : ' jade') : ', empty');
    var destMove = g.legalDests.find(function(m) { return m.to === idx; });
    if (destMove) desc += ', move using ' + destMove.die;
    var attrs = 'aria-label="' + desc + '" data-pt="' + idx + '" data-zone="' + (isTop ? 'top' : 'bot') + '" data-col="' + col + '"';
    if (!canFocus) attrs += ' tabindex="-1"';

    var html = '<button class="' + classes.join(' ') + '" ' + attrs + '>';
    html += '<span class="tri"></span>';
    html += '<span class="point-number">' + (idx + 1) + '</span>';
    if (g.selected === idx) html += '<span class="move-label">◆</span>';
    else if (destMove) html += '<span class="move-label">' + destMove.die + ' ↓</span>';

    if (cell) {
      var visible = Math.min(cell.count, MAX_VISIBLE_CHECKERS);
      html += '<span class="checker-stack">';
      for (var i = 0; i < visible; i++) {
        var showBadge = (i === visible - 1) && cell.count > MAX_VISIBLE_CHECKERS;
        html += '<span class="checker ' + cell.color + '">';
        if (showBadge) html += '<span class="checker-count">' + cell.count + '</span>';
        html += '</span>';
      }
      html += '</span>';
    }
    html += '</button>';
    return html;
  }

  function renderBoardRows() {
    var tl = '', tr = '', bl = '', br = '';
    for (var c = 0; c < 6; c++) tl += buildPointHTML(12 + c, true, c);
    for (var c = 6; c < 12; c++) tr += buildPointHTML(12 + c, true, c);
    for (var c = 0; c < 6; c++) bl += buildPointHTML(11 - c, false, c);
    for (var c = 6; c < 12; c++) br += buildPointHTML(11 - c, false, c);
    document.getElementById('row-top-left').innerHTML = tl;
    document.getElementById('row-top-right').innerHTML = tr;
    document.getElementById('row-bot-left').innerHTML = bl;
    document.getElementById('row-bot-right').innerHTML = br;
  }

  function renderBarCheckers() {
    var g = state.game;
    var barW = document.getElementById('bar-w');
    var barB = document.getElementById('bar-b');

    function setBar(el, count, focusable, selected) {
      if (count > 0) {
        el.classList.remove('hidden');
        el.innerHTML = '<span class="bar-count">' + count + '</span>';
        el.setAttribute('aria-label', count + ' checkers on the bar; enter these first');
      } else {
        el.classList.add('hidden');
        el.innerHTML = '';
      }
      el.classList.toggle('focusable', !!focusable);
      el.classList.toggle('selected', !!selected);
      if (focusable) el.removeAttribute('tabindex');
      else el.setAttribute('tabindex', '-1');
    }

    setBar(barB, g.bar.b, false, false);
    setBar(barW, g.bar.w, isFocusableBar(g), g.selected === 'bar');
  }

  function renderOffTrays() {
    var g = state.game;
    var w = document.getElementById('off-white-tray');
    var b = document.getElementById('off-black-tray');
    var hw = '', hb = '';
    for (var i = 0; i < g.off.w; i++) hw += '<div class="off-bar w"></div>';
    for (var i = 0; i < g.off.b; i++) hb += '<div class="off-bar b"></div>';
    w.innerHTML = hw;
    b.innerHTML = hb;
  }

  function pipPattern(value) {
    return {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8]
    }[value] || [];
  }

  function dieHTML(value, used, small) {
    var pips = pipPattern(value);
    var pipSet = {};
    pips.forEach(function (p) { pipSet[p] = true; });
    var classes = ['die'];
    if (used) classes.push('used');
    if (small) classes.push('doubles-extra');
    var html = '<div class="' + classes.join(' ') + '" role="img" aria-label="Die ' + value + (used ? ', used' : ', available') + '">';
    for (var i = 0; i < 9; i++) {
      html += '<span class="pip' + (pipSet[i] ? '' : ' empty') + '"></span>';
    }
    html += '</div>';
    return html;
  }

  function renderDice() {
    var area = document.getElementById('dice-area');
    var g = state.game;
    if (g.diceRolled.length === 0) {
      var msg = state.aiBusy
        ? 'Computer rolling…'
        : g.turn === COLOR_W ? 'Press Roll' : 'Computer’s turn';
      area.innerHTML = '<div class="dice-placeholder">' + msg + '</div>';
      return;
    }
    var html = '';
    var isDoubles = g.diceRolled.length === 4;
    for (var i = 0; i < g.diceRolled.length; i++) {
      html += dieHTML(g.diceRolled[i], g.diceUsed[i], isDoubles);
    }
    area.innerHTML = html;
  }

  function renderActions() {
    var g = state.game;
    var roll = document.getElementById('roll-btn');
    var dbl = document.getElementById('double-btn');
    var accept = document.getElementById('accept-btn');
    var decline = document.getElementById('decline-btn');
    var undo = document.getElementById('undo-btn');
    var end = document.getElementById('end-btn');
    var bear = document.getElementById('bear-btn');

    function setBtn(btn, visible, focusable, dest) {
      btn.classList.toggle('hidden', !visible);
      btn.classList.toggle('focusable', !!focusable);
      btn.classList.toggle('dest', !!dest);
      if (focusable) btn.removeAttribute('tabindex');
      else btn.setAttribute('tabindex', '-1');
    }

    var human = g.turn === COLOR_W && !state.aiBusy && !g.winner;

    // When AI has offered a double, the player must respond first —
    // hide every other action until they Accept or Decline.
    var awaitingResponse = g.cubeOffer !== null && g.cubeOffer.by === COLOR_B;
    var ourOfferPending  = g.cubeOffer !== null && g.cubeOffer.by === COLOR_W;

    setBtn(accept, awaitingResponse, awaitingResponse, false);
    setBtn(decline, awaitingResponse, awaitingResponse, false);
    if (awaitingResponse) accept.classList.add('accept'); else accept.classList.remove('accept');
    if (awaitingResponse) decline.classList.add('decline'); else decline.classList.remove('decline');

    var showRoll = human && g.phase === 'need-roll' && !g.cubeOffer;
    setBtn(roll, showRoll, showRoll, false);

    var showDouble = canOfferDouble(g, COLOR_W) && !state.aiBusy && !ourOfferPending;
    setBtn(dbl, showDouble, showDouble, false);

    var canUndo = human && !state.animating && state.snapshot && g.phase !== 'need-roll' && !g.winner && !g.cubeOffer;
    setBtn(undo, !!canUndo, !!canUndo, false);

    var stuck = human && !state.animating && g.phase === 'need-move'
                && allLegalMoves(g).length === 0 && !g.cubeOffer;
    setBtn(end, !!stuck, !!stuck, false);

    var canBear = false;
    if (g.selected !== null && human && !g.cubeOffer) {
      canBear = g.legalDests.some(function (m) { return m.to === 'off'; });
    }
    setBtn(bear, canBear, canBear, canBear);
    var cancel = document.getElementById('cancel-btn');
    setBtn(cancel, human && g.selected !== null && !state.animating, human && g.selected !== null && !state.animating, false);
  }

  function renderHeader() {
    var g = state.game;
    document.getElementById('white-remaining').innerHTML = g.off.w + ' / 15<span class="home-word"> home</span>';
    document.getElementById('black-remaining').innerHTML = g.off.b + ' / 15<span class="home-word"> home</span>';
  }

  function renderMidbarLabel() {
    var g = state.game;
    var label = document.getElementById('midbar-label');
    // Hide the turn label whenever we're showing the cube — keeps the
    // midbar uncluttered.
    if (g.winner) { label.textContent = ''; return; }
    label.textContent = g.turn === COLOR_W ? 'YOU: 24 → 1 → HOME' : 'COMPUTER: 1 → 24';
  }

  function renderCube() {
    var g = state.game;
    var cubeEl = document.getElementById('cube');
    var valEl = document.getElementById('cube-value');
    if (!cubeEl) return;

    // Hide cube entirely until either it's been used or a double is being
    // negotiated — keeps a clean board for first turn.
    var show = g.cube.value > 1 || g.cube.owner !== null || g.cubeOffer !== null;
    cubeEl.classList.toggle('hidden', !show);
    if (!show) {
      cubeEl.classList.remove('focusable', 'owner-w', 'owner-b', 'offered');
      cubeEl.setAttribute('tabindex', '-1');
      valEl.textContent = g.cube.value;
      return;
    }

    var displayValue = g.cubeOffer ? g.cubeOffer.value : g.cube.value;
    valEl.textContent = displayValue;

    cubeEl.classList.remove('owner-w', 'owner-b', 'offered');
    if (g.cube.owner === COLOR_W) cubeEl.classList.add('owner-w');
    else if (g.cube.owner === COLOR_B) cubeEl.classList.add('owner-b');
    if (g.cubeOffer) cubeEl.classList.add('offered');
    // Cube is mouse-clickable but not in D-pad nav — Double button covers that.
    cubeEl.setAttribute('tabindex', '-1');
  }

  function renderMatchScore() {
    var el = document.getElementById('match-score');
    if (!el) return;
    if (!state.match || state.match.length === 1) {
      el.textContent = state.game.opening ? 'Higher die starts' : 'Single game · ' + getDifficulty();
      return;
    }
    el.textContent = state.match.scoreW + ' – ' + state.match.scoreB + ' · First to ' + state.match.target + (state.game.crawford ? ' · No cube' : '');
  }

  function renderStatus() {
    var g = state.game;
    var st = document.getElementById('status-text');
    if (g.winner) {
      st.textContent = g.winner === COLOR_W ? 'You win!' : 'Computer wins';
      return;
    }
    if (g.cubeOffer && g.cubeOffer.by === COLOR_B) {
      st.textContent = 'Computer offers ' + g.cubeOffer.value + ' — accept?';
      return;
    }
    if (g.cubeOffer && g.cubeOffer.by === COLOR_W) {
      st.textContent = 'Computer is deciding…';
      return;
    }
    if (state.aiBusy) { st.textContent = 'Computer thinking…'; return; }
    if (g.opening) { st.textContent = 'Roll to see who starts'; return; }
    if (g.turn === COLOR_W) {
      if (g.phase === 'need-roll') {
        st.textContent = canOfferDouble(g, COLOR_W)
          ? 'Your turn — roll or double'
          : 'Your turn — roll the dice';
      }
      else if (!allLegalMoves(g).length) st.textContent = 'Move complete — end turn';
      else if (g.bar.w > 0) st.textContent = 'Enter from the bar';
      else if (g.selected !== null) st.textContent = 'Choose a destination';
      else st.textContent = 'Choose a checker to move';
    } else {
      st.textContent = 'Computer’s turn';
    }
  }

  function renderGame() {
    if (!state.game) return;
    var active = document.activeElement;
    var focusPoint = active && active.dataset.pt;
    renderHeader();
    renderBoardRows();
    renderBarCheckers();
    renderOffTrays();
    renderDice();
    renderActions();
    renderStatus();
    renderMidbarLabel();
    renderCube();
    renderMatchScore();
    if (focusPoint !== undefined && state.currentScreen === 'game') {
      var replacement = document.querySelector('[data-pt="' + focusPoint + '"].focusable');
      if (replacement) replacement.focus();
    }
  }

  // =================== SOUND ===================
  // All sounds are synthesized via Web Audio — zero asset weight, no
  // network requests, plays anywhere. Lazy-inits the AudioContext on the
  // first call (autoplay policies require a user gesture to start audio).
  var audioCtx = null;

  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function isSoundOn() {
    return !!(state.settings && state.settings.soundOn !== false);
  }

  function playSound(type) {
    if (!isSoundOn()) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
    }
    try {
      switch (type) {
        case 'roll':  sndRoll(ctx); break;
        case 'move':  sndClick(ctx, 500, 0.05, 0.12); break;
        case 'hit':   sndHit(ctx); break;
        case 'cube':  sndCube(ctx); break;
        case 'win':   sndWin(ctx); break;
        case 'lose':  sndLose(ctx); break;
      }
    } catch (e) {
      // Never let a sound failure crash gameplay.
    }
  }

  function sndClick(ctx, freq, dur, vol) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    var t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(t + dur + 0.02);
  }

  // A single plastic-dice impact: a fast-decaying bandpass-filtered noise
  // burst (the "tk" of the cube hitting wood) layered with a brief
  // low-frequency sine thump (the body of the impact). Pitch and volume
  // vary per call so a sequence sounds natural rather than mechanical.
  function diceClick(ctx, when, freq, vol) {
    var dur = 0.035;
    var sampleRate = ctx.sampleRate;
    var bufLen = Math.floor(dur * sampleRate);
    var buf = ctx.createBuffer(1, bufLen, sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufLen; i++) {
      var t = i / sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 90);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 5;

    var gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(when);
    src.stop(when + dur + 0.01);

    // Low-frequency body for louder impacts (the "thock" under the click).
    if (vol > 0.08) {
      var osc = ctx.createOscillator();
      var oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, when);
      osc.frequency.exponentialRampToValueAtTime(70, when + 0.04);
      oscGain.gain.setValueAtTime(0.0001, when);
      oscGain.gain.exponentialRampToValueAtTime(vol * 0.5, when + 0.002);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(oscGain).connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.06);
    }
  }

  function sndRoll(ctx) {
    // Two dice tumbling and settling. Each die produces a sequence of
    // impacts of decreasing amplitude (initial big hit, a couple of
    // bounces, then a final small click as it stops spinning).
    var now = ctx.currentTime;

    function scheduleDie(baseOffset, hits) {
      hits.forEach(function (t, i) {
        var when = now + baseOffset + t + (Math.random() - 0.5) * 0.02;
        var vol = Math.max(0.04, 0.24 - i * 0.045);
        var freq = 1600 + Math.random() * 1400;  // plastic-click range
        diceClick(ctx, when, freq, vol);
      });
    }

    // Two dice — slightly different timing so they don't sound like one
    scheduleDie(0,    [0,    0.07, 0.16, 0.27, 0.38]);
    scheduleDie(0.03, [0.02, 0.10, 0.20, 0.31, 0.42]);
  }

  function sndHit(ctx) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    var t = ctx.currentTime;
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(t + 0.24);
  }

  function sndCube(ctx) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';
    var t = ctx.currentTime;
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(720, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(t + 0.32);
  }

  function sndWin(ctx) {
    // C major arpeggio
    [262, 330, 392, 523].forEach(function (freq, idx) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'triangle';
      var t0 = ctx.currentTime + idx * 0.13;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
  }

  function sndLose(ctx) {
    // Descending two-note (E -> C)
    [330, 262].forEach(function (freq, idx) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'triangle';
      var t0 = ctx.currentTime + idx * 0.22;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.38);
    });
  }

  // =================== TOAST ===================
  function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.getElementById('app').appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove('visible'); }, 1800);
  }

  // =================== NAVIGATION ===================
  function collectScreens() {
    document.querySelectorAll('.screen').forEach(function (s) {
      if (s.id) screens[s.id] = s;
    });
  }

  function navigateTo(id, opts) {
    opts = opts || {};
    if (opts.addToHistory !== false && state.currentScreen) {
      state.screenHistory.push(state.currentScreen);
    }
    Object.keys(screens).forEach(function (k) { screens[k].classList.add('hidden'); });
    if (screens[id]) {
      screens[id].classList.remove('hidden');
      state.currentScreen = id;
      if (id === 'home') updateHomeButtons();
      if (id === 'match-setup') syncSetupChips();
      setTimeout(function () { focusFirstActionable(); }, 50);
    }
  }

  function navigateBack() {
    if (state.currentScreen === 'game' && state.game && !state.game.winner) {
      if (state.game.selected !== null && !state.aiBusy) deselect(); else pauseGame();
      return;
    }
    if (state.currentScreen === 'help') { navigateTo(helpReturn, { addToHistory: false }); return; }
    if (state.currentScreen === 'pause') { resumeGame(); return; }
    if (state.currentScreen === 'match-setup') { navigateTo('home', { addToHistory: false }); return; }
    if (state.screenHistory.length > 0) {
      navigateTo(state.screenHistory.pop(), { addToHistory: false });
    }
  }

  // =================== FOCUS ===================
  function focusFirstActionable() {
    var screen = screens[state.currentScreen];
    if (!screen) return;
    var el = screen.querySelector('.focusable:not(.hidden):not([disabled])');
    if (el) el.focus();
  }

  function focusFirstDest() {
    var screen = screens.game;
    if (!screen) return;
    var el = screen.querySelector('.point.dest, .action-btn.dest');
    if (el) el.focus();
  }

  function getZoneMap() {
    var screen = screens.game;
    var els = Array.from(screen.querySelectorAll('.focusable:not(.hidden):not([disabled])'));
    var zones = { top: {}, bot: {}, bar: null, action: [] };
    els.forEach(function (el) {
      var z = el.dataset.zone;
      if (z === 'top' || z === 'bot') {
        var c = parseInt(el.dataset.col, 10);
        zones[z][c] = el;
      } else if (z === 'bar') {
        zones.bar = el;
      } else if (z === 'action') {
        zones.action.push(el);
      }
    });
    zones.action.sort(function (a, b) {
      return parseInt(a.dataset.idx, 10) - parseInt(b.dataset.idx, 10);
    });
    return zones;
  }

  function nearestInRow(rowMap, col) {
    if (!rowMap) return null;
    for (var d = 0; d <= 11; d++) {
      if (rowMap[col - d]) return rowMap[col - d];
      if (rowMap[col + d]) return rowMap[col + d];
    }
    return null;
  }

  function stepInRow(rowMap, fromCol, step) {
    var c = fromCol + step;
    while (c >= 0 && c <= 11) {
      if (rowMap[c]) return rowMap[c];
      c += step;
    }
    c = step > 0 ? 0 : 11;
    while (c !== fromCol && c >= 0 && c <= 11) {
      if (rowMap[c]) return rowMap[c];
      c += step;
      if (c < 0 || c > 11) c = step > 0 ? 0 : 11;
    }
    return null;
  }

  function gameMoveFocus(direction) {
    var active = document.activeElement;
    var screen = screens.game;
    if (!active || !screen.contains(active)) { focusFirstActionable(); return; }
    var zones = getZoneMap();
    var az = active.dataset.zone;
    var ac = parseInt(active.dataset.col, 10);
    var target = null;

    if (direction === 'left' || direction === 'right') {
      var step = direction === 'right' ? 1 : -1;
      if (az === 'top' || az === 'bot') {
        target = stepInRow(zones[az], ac, step);
      } else if (az === 'action') {
        var i = zones.action.indexOf(active);
        var ni = (i + step + zones.action.length) % zones.action.length;
        target = zones.action[ni];
      } else if (az === 'bar') {
        target = nearestInRow(zones.top, step > 0 ? 6 : 5)
              || nearestInRow(zones.bot, step > 0 ? 6 : 5);
      }
    } else {
      var step2 = direction === 'down' ? 1 : -1;
      var order = ['top', 'bar', 'bot', 'action'];
      var idx = order.indexOf(az);
      var ni2 = idx + step2;
      while (ni2 >= 0 && ni2 < order.length) {
        var z = order[ni2];
        var col = isNaN(ac) ? 5 : ac;
        if (z === 'bar' && zones.bar) { target = zones.bar; break; }
        if ((z === 'top' || z === 'bot')) {
          var t = nearestInRow(zones[z], col);
          if (t) { target = t; break; }
        }
        if (z === 'action' && zones.action.length > 0) { target = zones.action[0]; break; }
        ni2 += step2;
      }
    }
    if (target) target.focus();
  }

  function genericMoveFocus(direction) {
    var screen = screens[state.currentScreen];
    if (!screen) return;
    var els = Array.from(screen.querySelectorAll('.focusable:not(.hidden):not([disabled])'));
    if (els.length === 0) return;
    var idx = els.indexOf(document.activeElement);
    if (idx === -1) { els[0].focus(); return; }
    var next;
    if (direction === 'up' || direction === 'left') {
      next = idx > 0 ? idx - 1 : els.length - 1;
    } else {
      next = idx < els.length - 1 ? idx + 1 : 0;
    }
    els[next].focus();
  }

  function moveFocus(direction) {
    if (state.currentScreen === 'game' && !state.aiBusy) gameMoveFocus(direction);
    else genericMoveFocus(direction);
  }

  // =================== ANIMATION ===================
  var MOVE_ANIM_MS = 260;

  function getElementCenter(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function getTopCheckerEl(idx) {
    var pt = document.querySelector('[data-pt="' + idx + '"]');
    if (!pt) return null;
    var stack = pt.querySelector('.checker-stack');
    if (!stack || !stack.children.length) return null;
    // The most recently added checker is the LAST child in DOM order
    // (buildPointHTML appends in a loop).
    return stack.lastElementChild;
  }

  function getBarCheckerEl(color) {
    return document.getElementById('bar-' + color);
  }

  function getOffPos(color) {
    var id = color === COLOR_W ? 'white-remaining' : 'black-remaining';
    var el = document.getElementById(id);
    if (!el) return { x: 300, y: 22 };
    return getElementCenter(el);
  }

  function flipAnimate(el, fromPos, toPos, duration) {
    return new Promise(function (resolve) {
      if (!el || !fromPos || !toPos) { resolve(); return; }
      var dx = (fromPos.x - toPos.x) / appScale;
      var dy = (fromPos.y - toPos.y) / appScale;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { resolve(); return; }
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      el.style.zIndex = '20';
      // Force reflow so the browser registers the start position.
      el.offsetHeight;
      el.style.transition = 'transform ' + (duration || MOVE_ANIM_MS) +
                            'ms cubic-bezier(0.4, 0, 0.2, 1)';
      el.style.transform = 'translate(0, 0)';
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        // Defensive: element may have been re-rendered out; check before clearing.
        if (el && el.style) {
          el.style.transition = '';
          el.style.transform = '';
          el.style.zIndex = '';
        }
        resolve();
      }
      // Belt-and-braces — transitionend isn't always reliable when the
      // element is removed/replaced mid-animation.
      setTimeout(finish, (duration || MOVE_ANIM_MS) + 30);
    });
  }

  function ghostAnimate(color, fromPos, toPos, duration) {
    return new Promise(function (resolve) {
      if (!fromPos || !toPos) { resolve(); return; }
      var ghost = document.createElement('div');
      ghost.className = 'ghost-checker ' + color;
      ghost.style.transform = 'scale(' + appScale + ')';
      document.body.appendChild(ghost);
      ghost.style.left = (fromPos.x - 17) + 'px';
      ghost.style.top = (fromPos.y - 17) + 'px';
      ghost.style.transition = 'none';
      ghost.offsetHeight;
      ghost.style.transition = 'left ' + duration + 'ms ease-in, top ' +
                               duration + 'ms ease-in, opacity ' + duration + 'ms ease-in';
      ghost.style.left = (toPos.x - 17) + 'px';
      ghost.style.top = (toPos.y - 17) + 'px';
      ghost.style.opacity = '0.1';
      setTimeout(function () {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
        resolve();
      }, duration + 30);
    });
  }

  // The core: captures positions, mutates state + plays sound, renders,
  // then animates the moved checker (and any hit checker) into place.
  // Returns a Promise that resolves once all animations are finished.
  function animateAndApplyMove(g, move) {
    return new Promise(function (resolve) {
      var color = g.turn;
      var hit = moveWouldHit(g, move);

      // 1. CAPTURE source position from current DOM.
      var fromPos = null;
      if (move.from === 'bar') {
        var be = getBarCheckerEl(color);
        if (be) fromPos = getElementCenter(be);
      } else {
        var src = getTopCheckerEl(move.from);
        if (src) fromPos = getElementCenter(src);
      }
      // For hits, also capture opponent blot position.
      var hitFromPos = null;
      if (hit) {
        var blot = getTopCheckerEl(move.to);
        if (blot) hitFromPos = getElementCenter(blot);
      }

      // 2. Mutate state, play sound, clear selection, then render.
      makeMove(g, move);
      saveGame();
      playSound(hit ? 'hit' : 'move');
      g.selected = null;
      g.legalDests = [];
      renderGame();

      // 3. Animate.
      var anims = [];
      if (fromPos) {
        if (move.to === 'off') {
          anims.push(ghostAnimate(color, fromPos, getOffPos(color), MOVE_ANIM_MS + 40));
        } else {
          var destEl = getTopCheckerEl(move.to);
          if (destEl) {
            anims.push(flipAnimate(destEl, fromPos, getElementCenter(destEl)));
          }
        }
      }
      if (hit && hitFromPos) {
        var opp = color === COLOR_W ? COLOR_B : COLOR_W;
        var barEl = getBarCheckerEl(opp);
        if (barEl) {
          anims.push(flipAnimate(barEl, hitFromPos, getElementCenter(barEl)));
        }
      }
      if (anims.length === 0) { resolve(); return; }
      Promise.all(anims).then(function () { resolve(); });
    });
  }

  // =================== ACTIONS / FLOW ===================
  function startNewGame() {
    cancelFlow();
    // "New game" — go to match-setup so user can pick length.
    state.snapshot = null;
    state.aiBusy = false;
    navigateTo('match-setup', { addToHistory: false });
  }

  function startMatch(length) {
    cancelFlow();
    state.match = newMatchState(length, state.settings && state.settings.difficulty);
    state.game = newGameState();
    state.snapshot = null;
    state.aiBusy = false;
    saveGame();
    navigateTo('game', { addToHistory: false });
    renderGame();
    later(focusFirstActionable, 80);
  }

  function syncSetupChips() {
    var diff = (state.settings && state.settings.difficulty) || 'normal';
    document.querySelectorAll('[data-difficulty]').forEach(function (c) {
      c.classList.toggle('active', c.dataset.difficulty === diff);
      c.setAttribute('aria-pressed', c.dataset.difficulty === diff);
    });
    var soundOn = !state.settings || state.settings.soundOn !== false;
    document.querySelectorAll('[data-sound]').forEach(function (c) {
      var on = c.dataset.sound === 'on';
      c.classList.toggle('active', on === soundOn);
      c.setAttribute('aria-pressed', on === soundOn);
    });
  }

  function startNextGameInMatch() {
    if (!state.match) return;
    cancelFlow();
    state.match.gameNumber++;
    state.game = newGameState();
    if (!state.match.crawfordPlayed && state.match.target > 1 &&
        Math.max(state.match.scoreW, state.match.scoreB) === state.match.target - 1) {
      state.game.crawford = true;
      state.match.crawfordPlayed = true;
    }
    state.snapshot = null;
    state.aiBusy = false;
    saveGame();
    navigateTo('game', { addToHistory: false });
    renderGame();
    later(focusFirstActionable, 80);
  }

  function continueSavedGame() {
    var saved = loadSavedGame();
    if (!saved) return;
    cancelFlow();
    state.game = saved.game;
    state.match = saved.match;
    state.snapshot = null;
    state.aiBusy = false;
    if (state.game.winner) { showResult(); return; }
    navigateTo('game', { addToHistory: state.currentScreen === 'home' });
    if (gameWinner(state.game)) { onGameEnd(gameWinner(state.game)); return; }
    if (state.game.cubeOffer && state.game.cubeOffer.by === COLOR_W) {
      state.aiBusy = true; later(aiRespondToDouble, 500);
    } else if (state.game.turn === COLOR_B && !state.game.cubeOffer) {
      state.aiBusy = true;
      later(state.game.phase === 'need-move' ? playAiMoves : aiTurnStart, 500);
    }
    renderGame();
    later(focusFirstActionable, 80);
  }

  function rollDice() {
    var g = state.game;
    var d1 = 1 + Math.floor(Math.random() * 6);
    var d2 = 1 + Math.floor(Math.random() * 6);
    if (d1 === d2) {
      g.diceRolled = [d1, d1, d1, d1];
      g.diceRemaining = [d1, d1, d1, d1];
      g.diceUsed = [false, false, false, false];
    } else {
      g.diceRolled = [d1, d2];
      g.diceRemaining = [d1, d2];
      g.diceUsed = [false, false];
    }
    g.phase = 'need-move';
    playSound('roll');
  }

  // Returns true if applying `move` to `g` would hit an opponent blot.
  function moveWouldHit(g, move) {
    if (move.to === 'off' || move.from === undefined) return false;
    var dest = g.board[move.to];
    return !!(dest && dest.color !== g.turn && dest.count === 1);
  }

  function handleRoll() {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.phase !== 'need-roll' || state.aiBusy || g.cubeOffer) return;
    rollDice();
    if (g.opening) {
      // Each player rolls one die. Ties are rerolled on the next activation.
      if (g.diceRolled[0] === g.diceRolled[1]) {
        g.diceRolled = g.diceRolled.slice(0, 2);
        g.diceRemaining = [];
        g.diceUsed = [false, false];
        g.phase = 'need-roll'; showToast('Opening tie — roll again'); renderGame(); saveGame(); return;
      }
      g.opening = false;
      g.turn = g.diceRolled[0] > g.diceRolled[1] ? COLOR_W : COLOR_B;
      if (g.turn === COLOR_B) { state.aiBusy = true; later(playAiMoves, 800); }
      showToast(g.turn === COLOR_W ? 'Your ivory die is higher — you start' : 'The jade die is higher — computer starts');
    }
    state.snapshot = null;
    saveGame();
    renderGame();
    if (allLegalMoves(g).length === 0) {
      showToast('No legal moves');
      focusFirstActionable();
      return;
    }
    later(focusFirstActionable, 30);
  }

  function selectSource(src) {
    var g = state.game;
    g.selected = src;
    g.legalDests = legalMovesForSelection(g, src);
    saveGame();
    renderGame();
    later(focusFirstDest, 20);
  }

  function deselect() {
    var g = state.game;
    g.selected = null;
    g.legalDests = [];
    saveGame();
    renderGame();
    later(focusFirstActionable, 20);
  }

  function executeMove(move) {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || state.aiBusy || state.animating || g.cubeOffer || g.phase !== 'need-move') return;
    move = allLegalMoves(g).find(function(m) { return m.from === move.from && m.to === move.to && m.die === move.die; });
    if (!move) return;
    var epoch = flowEpoch;
    state.snapshot = deepClone(g);
    state.animating = true;
    // animateAndApplyMove handles: makeMove, playSound, clear selection,
    // renderGame, then the visual animation. Resolves when animation is done.
    animateAndApplyMove(g, move).then(function () {
      if (flowEpoch !== epoch || state.game !== g) return;
      state.animating = false;
      var w = gameWinner(g);
      if (w) {
        onGameEnd(w);
        return;
      }
      saveGame();
      if (g.diceRemaining.length === 0 || allLegalMoves(g).length === 0) {
        if (g.diceRemaining.length > 0) showToast('No more moves');
        renderGame();
        if (state.currentScreen === 'game') document.getElementById('end-btn').focus();
      } else {
        renderGame();
        later(focusFirstActionable, 30);
      }
    });
  }

  function handlePointClick(idx) {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.phase !== 'need-move' || state.aiBusy || state.animating) return;
    if (g.selected !== null) {
      if (g.selected === idx) { deselect(); return; }
      var move = g.legalDests.find(function (m) { return m.to === idx; });
      if (move) { executeMove(move); return; }
    }
    if (isFocusableSource(g, idx)) selectSource(idx);
  }

  function handleBarClick() {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.phase !== 'need-move' || state.aiBusy || state.animating) return;
    if (g.selected === 'bar') { deselect(); return; }
    if (isFocusableBar(g)) selectSource('bar');
  }

  function handleBearOff() {
    var g = state.game;
    if (!g || g.selected === null || state.animating) return;
    var move = g.legalDests.find(function (m) { return m.to === 'off'; });
    if (move) executeMove(move);
  }

  function handleUndo() {
    if (!state.snapshot || state.aiBusy || state.animating) return;
    state.game = state.snapshot;
    state.game.selected = null;
    state.game.legalDests = [];
    state.snapshot = null;
    saveGame();
    renderGame();
    later(focusFirstActionable, 30);
  }

  function endHumanTurn() {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.winner || g.phase !== 'need-move' || state.animating || g.cubeOffer || allLegalMoves(g).length) return;
    g.diceRolled = [];
    g.diceRemaining = [];
    g.diceUsed = [];
    g.selected = null;
    g.legalDests = [];
    g.turn = COLOR_B;
    g.phase = 'need-roll';
    state.snapshot = null;
    state.aiBusy = true;
    saveGame();
    renderGame();
    later(aiTurnStart, 600);
  }

  // AI's turn begins with the cube decision. If we offer, control passes
  // back to the player to Accept/Decline; if we don't (or after accept),
  // aiTurnRoll() is called to actually play the turn.
  function aiTurnStart() {
    var g = state.game;
    if (!g || g.winner || g.turn !== COLOR_B || g.cubeOffer) return;
    state.aiBusy = true;
    renderGame();
    later(function () {
      if (aiShouldOfferDouble(g)) {
        aiOfferDouble();
      } else {
        aiTurnRoll();
      }
    }, 300);
  }

  function aiOfferDouble() {
    var g = state.game;
    var newValue = g.cube.value * 2;
    if (newValue > 64) { aiTurnRoll(); return; }
    g.cubeOffer = { by: COLOR_B, value: newValue };
    state.aiBusy = false; // yield to player to respond
    playSound('cube');
    saveGame();
    renderGame();
    later(focusFirstActionable, 30);
  }

  function aiTurnRoll() {
    var g = state.game;
    state.aiBusy = true;
    renderGame();
    rollDice();
    saveGame();
    renderGame();
    later(function () {
      if (allLegalMoves(g).length === 0) {
        showToast('Computer has no moves');
        later(endAiTurn, 900);
        return;
      }
      playAiMoves();
    }, AI_ROLL_DELAY);
  }

  // ---------- Cube handlers ----------
  function handleDouble() {
    var g = state.game;
    if (!g || state.aiBusy || !canOfferDouble(g, COLOR_W)) return;
    var newValue = g.cube.value * 2;
    if (newValue > 64) return;
    g.cubeOffer = { by: COLOR_W, value: newValue };
    state.aiBusy = true;
    playSound('cube');
    saveGame();
    renderGame();
    later(aiRespondToDouble, 800);
  }

  function aiRespondToDouble() {
    var g = state.game;
    if (!g || !g.cubeOffer || g.cubeOffer.by !== COLOR_W) return;
    if (aiShouldAcceptDouble(g)) {
      g.cube.value = g.cubeOffer.value;
      g.cube.owner = COLOR_B;
      g.cubeOffer = null;
      state.aiBusy = false;
      playSound('cube');
      showToast('Computer accepts');
      saveGame();
      renderGame();
      later(focusFirstActionable, 30);
    } else {
      // Decline — player wins this game at the OLD cube value.
      showToast('Computer declines — you win this game');
      g.cubeOffer = null;
      state.aiBusy = false;
      onGameEnd(COLOR_W, true);
    }
  }

  function handleAcceptDouble() {
    var g = state.game;
    if (!g || !g.cubeOffer || g.cubeOffer.by !== COLOR_B) return;
    g.cube.value = g.cubeOffer.value;
    g.cube.owner = COLOR_W;
    g.cubeOffer = null;
    state.aiBusy = true;
    playSound('cube');
    showToast('You accept');
    saveGame();
    renderGame();
    // AI was about to roll — continue AI's turn.
    later(aiTurnRoll, 500);
  }

  function handleDeclineDouble() {
    var g = state.game;
    if (!g || !g.cubeOffer || g.cubeOffer.by !== COLOR_B) return;
    showToast('You decline');
    g.cubeOffer = null;
    onGameEnd(COLOR_B, true);
  }

  function playAiMoves() {
    var g = state.game;
    var epoch = flowEpoch;
    state.aiBusy = true;
    function next() {
      if (epoch !== flowEpoch || state.game !== g || g.turn !== COLOR_B) return;
      if (!g || g.winner) { endAiTurn(); return; }
      if (g.diceRemaining.length === 0) { endAiTurn(); return; }
      var move = aiPickBestMove(g);
      if (!move) { endAiTurn(); return; }
      g.selected = move.from === 'bar' ? 'bar' : move.from;
      g.legalDests = [move];
      renderGame();
      later(function () {
        animateAndApplyMove(g, move).then(function () {
          if (epoch !== flowEpoch || state.game !== g) return;
          var w = gameWinner(g);
          if (w) {
            later(function () {
              state.aiBusy = false;
              onGameEnd(w);
            }, 500);
            return;
          }
          later(next, AI_MOVE_DELAY - 60);
        });
      }, AI_SELECT_DELAY);
    }
    next();
  }

  function endAiTurn() {
    var g = state.game;
    if (!g || g.turn !== COLOR_B || g.winner) return;
    g.diceRolled = [];
    g.diceRemaining = [];
    g.diceUsed = [];
    g.selected = null;
    g.legalDests = [];
    g.turn = COLOR_W;
    g.phase = g.winner ? 'gameover' : 'need-roll';
    state.aiBusy = false;
    state.snapshot = null;
    saveGame();
    renderGame();
    later(focusFirstActionable, 30);
  }

  function onGameEnd(winnerColor, dropped) {
    var g = state.game;
    if (!g || g.winner) return;
    // Compute multiplier BEFORE marking winner (depends on board state).
    var multiplier = dropped ? 1 : gameWinMultiplier(g, winnerColor);
    var points = g.cube.value * multiplier;
    g.winner = winnerColor;
    g.lastMultiplier = multiplier;
    g.lastPoints = points;
    g.phase = 'gameover';
    if (!state.match) state.match = newMatchState(1);
    if (winnerColor === COLOR_W) state.match.scoreW += points;
    else state.match.scoreB += points;
    saveGame();
    state.aiBusy = false;
    playSound(winnerColor === COLOR_W ? 'win' : 'lose');
    renderGame();

    var matchOver = state.match.scoreW >= state.match.target ||
                    state.match.scoreB >= state.match.target;

    var who = winnerColor === COLOR_W ? 'You' : 'Computer';
    var winVerb = winnerColor === COLOR_W ? 'win' : 'wins';
    var typeLabel = multiplier === 3 ? 'Backgammon! ' :
                    multiplier === 2 ? 'Gammon! ' : '';

    if (state.currentScreen === 'game') showResult();
    else deferred.push(showResult);
  }

  function showResult() {
    if (state.match.scoreW >= state.match.target || state.match.scoreB >= state.match.target) { showMatchOver(); return; }
    var g = state.game;
    document.getElementById('winner-emblem').textContent = '♕';
    document.getElementById('winner-title').textContent = g.winner === COLOR_W ? 'You win this round' : 'Computer wins this round';
    document.getElementById('winner-sub').textContent = '+' + g.lastPoints + ' points · Match ' + state.match.scoreW + ' – ' + state.match.scoreB;
    navigateTo('gameover', { addToHistory: false });
  }

  var helpPages = [
    '<h2>Move your ivory checkers home</h2><p>Roll one die each to start. The higher die plays first, using both numbers. On later turns, roll two dice.</p><p>Follow the numbers from 24 down to 1. Bring all 15 ivory checkers into points 1–6, then bear them off.</p>',
    '<h2>Choose a checker, then its landing</h2><p>Use arrows or your band’s D-pad to focus a control. Pinch / Enter activates it. You can also tap the board.</p><p>The ◆ marks your selected checker. Outlined landings show the die they use. Cancel changes your choice. Undo is available until you End Turn.</p>',
    '<h2>Hits, dice &amp; match points</h2><p>A lone enemy checker can be hit. Checkers on the bar must enter first. Use both dice when possible; if only one fits, use the higher. Doubles give four moves.</p><p>A gammon scores 2×, backgammon 3×. Declining a double loses the old cube value. The first one-point-away round has no doubling (Crawford).</p>'
  ];
  function renderHelp() {
    document.getElementById('help-copy').innerHTML = helpPages[helpPage];
    document.getElementById('help-page').textContent = (helpPage + 1) + ' / ' + helpPages.length;
  }

  function showMatchOver() {
    var m = state.match;
    var winner = m.scoreW >= m.target ? COLOR_W : COLOR_B;
    var single = m.length === 1;
    var emb = document.getElementById('match-winner-emblem');
    var title = document.getElementById('match-winner-title');
    var sub = document.getElementById('match-winner-sub');
    emb.className = 'winner-emblem ' + winner;
    emb.textContent = winner === COLOR_W ? '♕' : '♛';
    var g = state.game;
    var mult = g && g.lastMultiplier;
    var typeLabel = mult === 3 ? ' by backgammon' :
                    mult === 2 ? ' by gammon' : '';
    if (single) {
      title.textContent = (winner === COLOR_W ? 'You win!' : 'Computer wins') + typeLabel;
      sub.textContent = mult > 1 ? '+' + (g.lastPoints || mult) + ' points' : '';
    } else {
      title.textContent = winner === COLOR_W ? 'Match won!' : 'Computer wins the match';
      sub.textContent = 'Final score: ' + m.scoreW + ' – ' + m.scoreB +
                       (typeLabel ? ' (' + typeLabel.trim() + ')' : '');
    }
    navigateTo('matchover');
  }

  // =================== EVENT WIRING ===================
  function handleAction(action) {
    switch (action) {
      case 'new-game': startNewGame(); break;
      case 'continue': continueSavedGame(); break;
      case 'match-1': startMatch(1); break;
      case 'match-3': startMatch(3); break;
      case 'match-5': startMatch(5); break;
      case 'match-7': startMatch(7); break;
      case 'next-round': startNextGameInMatch(); break;
      case 'pause': pauseGame(); break;
      case 'resume': resumeGame(); break;
      case 'cancel': deselect(); break;
      case 'help': helpReturn = state.currentScreen; helpPage = 0; renderHelp(); navigateTo('help', { addToHistory: false }); break;
      case 'help-prev': helpPage = (helpPage + helpPages.length - 1) % helpPages.length; renderHelp(); break;
      case 'help-next': helpPage = (helpPage + 1) % helpPages.length; renderHelp(); break;
      case 'help-close': navigateTo(helpReturn, { addToHistory: false }); break;
      case 'home':
        saveGame(); cancelFlow();
        state.screenHistory = [];
        navigateTo('home', { addToHistory: false });
        break;
      case 'back': navigateBack(); break;
      case 'roll': handleRoll(); break;
      case 'double': handleDouble(); break;
      case 'accept-double': handleAcceptDouble(); break;
      case 'decline-double': handleDeclineDouble(); break;
      case 'undo': handleUndo(); break;
      case 'end-turn': endHumanTurn(); break;
      case 'bear-off': handleBearOff(); break;
    }
  }

  function setupEvents() {
    document.addEventListener('click', function (e) {
      if (!screens[state.currentScreen].contains(e.target)) return;
      // Setup chips (difficulty / sound).
      var diffChip = e.target.closest('[data-difficulty]');
      if (diffChip) {
        state.settings.difficulty = diffChip.dataset.difficulty;
        saveSettings();
        syncSetupChips();
        return;
      }
      var soundChip = e.target.closest('[data-sound]');
      if (soundChip) {
        state.settings.soundOn = soundChip.dataset.sound === 'on';
        saveSettings();
        syncSetupChips();
        return;
      }

      var pt = e.target.closest('[data-pt]');
      if (pt) {
        handlePointClick(parseInt(pt.dataset.pt, 10));
        return;
      }
      var bar = e.target.closest('[data-zone="bar"][data-side="w"]');
      if (bar) { handleBarClick(); return; }
      var act = e.target.closest('[data-action]');
      if (act) handleAction(act.dataset.action);
    });

    document.addEventListener('keydown', function (e) {
      switch (e.key) {
        case 'ArrowUp': moveFocus('up'); e.preventDefault(); break;
        case 'ArrowDown': moveFocus('down'); e.preventDefault(); break;
        case 'ArrowLeft': moveFocus('left'); e.preventDefault(); break;
        case 'ArrowRight': moveFocus('right'); e.preventDefault(); break;
        case 'Enter':
          if (e.repeat) { e.preventDefault(); break; }
          if (document.activeElement && document.activeElement.classList.contains('focusable')) {
            document.activeElement.click();
          }
          e.preventDefault();
          break;
        case 'Escape':
          navigateBack();
          e.preventDefault();
          break;
      }
    });
  }

  // =================== INIT ===================
  function init() {
    fit(); window.addEventListener('resize', fit);
    collectScreens();
    state.settings = loadSettings();
    setupEvents();
    window.addEventListener('pagehide', saveGame);
    navigateTo('home', { addToHistory: false });
  }

  window.render_game_to_text = function () {
    var g = state.game;
    return JSON.stringify({ screen: state.currentScreen, focus: document.activeElement && (document.activeElement.dataset.action || document.activeElement.getAttribute('aria-label')), aiBusy: state.aiBusy,
      coordinates: '24 points; ivory moves 24 down to 1, jade 1 up to 24; top left to right 13–24, bottom left to right 12–1',
      game: g && { turn:g.turn, phase:g.phase, opening:g.opening, board:g.board, bar:g.bar, off:g.off, dice:g.diceRemaining, selected:g.selected, legal:g.legalDests, cube:g.cube, cubeOffer:g.cubeOffer, winner:g.winner }, match:state.match });
  };
  window.advanceTime = function(ms) { return new Promise(function(resolve) { setTimeout(resolve, Math.max(0, Math.min(ms, 30000))); }); };
  // Local verification only; no hidden gameplay controls in the deployed app.
  if (location.hostname === '127.0.0.1' && new URLSearchParams(location.search).has('test')) {
    window.__bg = { state:state, newGame:newGameState, newMatch:newMatchState, legal:allLegalMoves, raw:rawLegalMoves, move:makeMove, multiplier:gameWinMultiplier, canDouble:canOfferDouble,
      load:loadSavedGame, save:saveGame, result:onGameEnd, nextRound:startNextGameInMatch, start:startMatch, action:handleAction,
      set:function(g,m) { cancelFlow(); state.game=g; state.match=m||newMatchState(7); state.aiBusy=false; state.snapshot=null; navigateTo('game',{addToHistory:false}); renderGame(); }, render:renderGame };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
