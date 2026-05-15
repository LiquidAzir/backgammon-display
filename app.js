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

  // =================== STATE ===================
  var state = {
    currentScreen: 'home',
    screenHistory: [],
    game: null,
    snapshot: null,
    aiBusy: false,
  };

  var screens = {};

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
    };
  }

  function deepClone(g) {
    return JSON.parse(JSON.stringify(g));
  }

  // =================== PERSISTENCE ===================
  // Save only at stable points (not mid-AI animation). The saved snapshot is
  // always either a fresh game or a state where it's the human's turn — so
  // resuming never lands in the middle of the computer thinking.
  function saveGame() {
    if (!state.game) return;
    if (state.aiBusy) return;
    if (state.game.winner) { clearSavedGame(); return; }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.game));
    } catch (e) {
      // quota or disabled — silently ignore
    }
  }

  function loadSavedGame() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var g = JSON.parse(raw);
      // Basic shape validation — anything off, treat as no save
      if (!g || !Array.isArray(g.board) || g.board.length !== 24) return null;
      if (g.winner) return null;
      return g;
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

  function legalMovesForSelection(g, source) {
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

  function allLegalMoves(g) {
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
      legalMovesForSelection(g, src).forEach(function (m) { moves.push(m); });
    });
    return moves;
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

  function aiPickBestMove(g) {
    var moves = allLegalMoves(g);
    if (moves.length === 0) return null;
    var best = moves[0];
    var bestScore = aiScoreMove(g, moves[0]);
    for (var i = 1; i < moves.length; i++) {
      var s = aiScoreMove(g, moves[i]);
      if (s > bestScore) { bestScore = s; best = moves[i]; }
    }
    return best;
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
    var canFocus = isFocusableSource(g, idx) || isDestPoint(g, idx) || (g.selected === idx);
    if (canFocus) classes.push('focusable');
    if (g.selected === idx) classes.push('selected');
    if (isDestPoint(g, idx)) classes.push('dest');

    var attrs = 'data-pt="' + idx + '" data-zone="' + (isTop ? 'top' : 'bot') + '" data-col="' + col + '"';
    if (!canFocus) attrs += ' tabindex="-1"';

    var html = '<button class="' + classes.join(' ') + '" ' + attrs + '>';
    html += '<span class="tri"></span>';

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
        el.innerHTML = count > 1 ? '<span class="bar-count">' + count + '</span>' : '';
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
    var html = '<div class="' + classes.join(' ') + '">';
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

    setBtn(roll, human && g.phase === 'need-roll', human && g.phase === 'need-roll', false);

    var canUndo = human && state.snapshot && g.phase !== 'need-roll' && !g.winner;
    setBtn(undo, !!canUndo, !!canUndo, false);

    // End-turn button only when player has dice remaining but no possible moves
    var stuck = human && g.phase === 'need-move' && g.diceRemaining.length > 0
                && allLegalMoves(g).length === 0;
    setBtn(end, !!stuck, !!stuck, false);

    var canBear = false;
    if (g.selected !== null && human) {
      canBear = g.legalDests.some(function (m) { return m.to === 'off'; });
    }
    setBtn(bear, canBear, canBear, canBear);
  }

  function renderHeader() {
    var g = state.game;
    document.getElementById('white-remaining').textContent = 15 - g.off.w;
    document.getElementById('black-remaining').textContent = 15 - g.off.b;
  }

  function renderMidbarLabel() {
    var g = state.game;
    var label = document.getElementById('midbar-label');
    if (g.winner) { label.textContent = ''; return; }
    label.textContent = g.turn === COLOR_W ? 'WHITE' : 'BLACK';
  }

  function renderStatus() {
    var g = state.game;
    var st = document.getElementById('status-text');
    if (g.winner) {
      st.textContent = g.winner === COLOR_W ? 'You win!' : 'Computer wins';
      return;
    }
    if (state.aiBusy) { st.textContent = 'Computer thinking…'; return; }
    if (g.turn === COLOR_W) {
      if (g.phase === 'need-roll') st.textContent = 'Your turn — roll the dice';
      else if (g.bar.w > 0) st.textContent = 'Enter from the bar';
      else if (g.selected !== null) st.textContent = 'Choose a destination';
      else st.textContent = 'Choose a checker to move';
    } else {
      st.textContent = 'Computer’s turn';
    }
  }

  function renderGame() {
    if (!state.game) return;
    renderHeader();
    renderBoardRows();
    renderBarCheckers();
    renderOffTrays();
    renderDice();
    renderActions();
    renderStatus();
    renderMidbarLabel();
  }

  // =================== TOAST ===================
  function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
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
      setTimeout(function () { focusFirstActionable(); }, 50);
    }
  }

  function navigateBack() {
    if (state.currentScreen === 'game' && state.game && !state.game.winner) {
      // Don't auto-back out of an active game on Escape
      return;
    }
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

  // =================== ACTIONS / FLOW ===================
  function startNewGame() {
    state.game = newGameState();
    state.snapshot = null;
    state.aiBusy = false;
    saveGame();
    navigateTo('game', { addToHistory: state.currentScreen === 'home' });
    renderGame();
    setTimeout(focusFirstActionable, 80);
  }

  function continueSavedGame() {
    var saved = loadSavedGame();
    if (!saved) return;
    state.game = saved;
    state.snapshot = null;
    state.aiBusy = false;
    navigateTo('game', { addToHistory: state.currentScreen === 'home' });
    renderGame();
    setTimeout(focusFirstActionable, 80);
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
  }

  function handleRoll() {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.phase !== 'need-roll' || state.aiBusy) return;
    rollDice();
    state.snapshot = null;
    saveGame();
    renderGame();
    if (allLegalMoves(g).length === 0) {
      showToast('No legal moves');
      setTimeout(endHumanTurn, 1100);
      return;
    }
    setTimeout(focusFirstActionable, 30);
  }

  function selectSource(src) {
    var g = state.game;
    g.selected = src;
    g.legalDests = legalMovesForSelection(g, src);
    saveGame();
    renderGame();
    setTimeout(focusFirstDest, 20);
  }

  function deselect() {
    var g = state.game;
    g.selected = null;
    g.legalDests = [];
    saveGame();
    renderGame();
    setTimeout(focusFirstActionable, 20);
  }

  function executeMove(move) {
    var g = state.game;
    state.snapshot = deepClone(g);
    makeMove(g, move);
    g.selected = null;
    g.legalDests = [];
    var w = gameWinner(g);
    if (w) {
      g.winner = w;
      g.phase = 'gameover';
      clearSavedGame();
      renderGame();
      setTimeout(showGameOver, 900);
      return;
    }
    saveGame();
    renderGame();
    if (g.diceRemaining.length === 0 || allLegalMoves(g).length === 0) {
      if (g.diceRemaining.length > 0) showToast('No more moves');
      setTimeout(endHumanTurn, END_TURN_DELAY);
    } else {
      setTimeout(focusFirstActionable, 30);
    }
  }

  function handlePointClick(idx) {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.phase !== 'need-move' || state.aiBusy) return;
    if (g.selected !== null) {
      if (g.selected === idx) { deselect(); return; }
      var move = g.legalDests.find(function (m) { return m.to === idx; });
      if (move) { executeMove(move); return; }
    }
    if (isFocusableSource(g, idx)) selectSource(idx);
  }

  function handleBarClick() {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.phase !== 'need-move' || state.aiBusy) return;
    if (g.selected === 'bar') { deselect(); return; }
    if (isFocusableBar(g)) selectSource('bar');
  }

  function handleBearOff() {
    var g = state.game;
    if (!g || g.selected === null) return;
    var move = g.legalDests.find(function (m) { return m.to === 'off'; });
    if (move) executeMove(move);
  }

  function handleUndo() {
    if (!state.snapshot || state.aiBusy) return;
    state.game = state.snapshot;
    state.snapshot = null;
    saveGame();
    renderGame();
    setTimeout(focusFirstActionable, 30);
  }

  function endHumanTurn() {
    var g = state.game;
    if (!g || g.turn !== COLOR_W || g.winner) return;
    g.diceRolled = [];
    g.diceRemaining = [];
    g.diceUsed = [];
    g.selected = null;
    g.legalDests = [];
    g.turn = COLOR_B;
    g.phase = 'need-roll';
    state.snapshot = null;
    renderGame();
    setTimeout(aiTurn, 600);
  }

  function aiTurn() {
    var g = state.game;
    if (!g || g.winner) return;
    state.aiBusy = true;
    renderGame();
    setTimeout(function () {
      rollDice();
      renderGame();
      setTimeout(function () {
        if (allLegalMoves(g).length === 0) {
          showToast('Computer has no moves');
          setTimeout(endAiTurn, 900);
          return;
        }
        playAiMoves();
      }, AI_ROLL_DELAY);
    }, 300);
  }

  function playAiMoves() {
    var g = state.game;
    function next() {
      if (!g || g.winner) { endAiTurn(); return; }
      if (g.diceRemaining.length === 0) { endAiTurn(); return; }
      var move = aiPickBestMove(g);
      if (!move) { endAiTurn(); return; }
      g.selected = move.from === 'bar' ? 'bar' : move.from;
      g.legalDests = [move];
      renderGame();
      setTimeout(function () {
        makeMove(g, move);
        g.selected = null;
        g.legalDests = [];
        var w = gameWinner(g);
        if (w) {
          g.winner = w;
          g.phase = 'gameover';
          clearSavedGame();
          renderGame();
          setTimeout(function () {
            state.aiBusy = false;
            showGameOver();
          }, 900);
          return;
        }
        renderGame();
        setTimeout(next, AI_MOVE_DELAY);
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
    setTimeout(focusFirstActionable, 30);
  }

  function showGameOver() {
    var g = state.game;
    var emb = document.getElementById('winner-emblem');
    var title = document.getElementById('winner-title');
    var sub = document.getElementById('winner-sub');
    var w = g.winner;
    emb.className = 'winner-emblem ' + w;
    emb.textContent = w === COLOR_W ? '♕' : '♛';
    title.textContent = w === COLOR_W ? 'You win!' : 'Computer wins';
    sub.textContent = w === COLOR_W ? 'Nicely played.' : 'Try again?';
    navigateTo('gameover');
  }

  // =================== EVENT WIRING ===================
  function handleAction(action) {
    switch (action) {
      case 'new-game': startNewGame(); break;
      case 'continue': continueSavedGame(); break;
      case 'home':
        state.screenHistory = [];
        navigateTo('home', { addToHistory: false });
        break;
      case 'back': navigateBack(); break;
      case 'roll': handleRoll(); break;
      case 'undo': handleUndo(); break;
      case 'end-turn': endHumanTurn(); break;
      case 'bear-off': handleBearOff(); break;
    }
  }

  function setupEvents() {
    document.addEventListener('click', function (e) {
      var pt = e.target.closest('[data-pt]');
      if (pt && !pt.classList.contains('focusable')) {
        var p = parseInt(pt.dataset.pt, 10);
        if (state.game && state.game.selected !== null) {
          var move = state.game.legalDests.find(function (m) { return m.to === p; });
          if (move) { executeMove(move); return; }
        }
      }
      if (pt && pt.classList.contains('focusable')) {
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
    collectScreens();
    setupEvents();
    setTimeout(function () {
      navigateTo('home', { addToHistory: false });
    }, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
