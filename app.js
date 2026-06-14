/* ============================================================
   CMD COUNTER — app.js
   Main game logic
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
let state = {
  format: 'commander',
  startingLife: 40,
  playerCount: 4,
  players: [],
  turnOrder: [],
  currentTurnIndex: 0,
  history: [],        // [{playerId, field, delta, prevVal, newVal, ts}]
  lastExport: null,   // ISO timestamp
  gameStarted: false,
};

let setupPlayerCount = 4;
let setupFormat = 'commander';

const MTG_COLORS = ['W','U','B','R','G','C'];
const COLOR_LABELS = { W:'White', U:'Blue', B:'Black', R:'Red', G:'Green', C:'Colorless' };

// ── Boot ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Fix iOS: prevent passive touch listeners from blocking button taps
  // by adding a no-op touchstart to document (unlocks fast-tap on all elements)
  document.addEventListener('touchstart', function(){}, {passive: true});

  const saved = await loadFromDB();
  if (saved && saved.gameStarted) {
    state = saved;
    showScreen('game');
    renderGame();
  } else {
    if (saved) {
      setupPlayerCount = saved.playerCount || 4;
      setupFormat = saved.format || 'commander';
    }
    renderSetup();
    showScreen('setup');
  }
  registerServiceWorker();
});

// ── Service Worker ───────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

// ── Screen switching ─────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ── Setup ────────────────────────────────────────────────────
function renderSetup() {
  document.getElementById('player-count-display').textContent = setupPlayerCount;

  const list = document.getElementById('player-setup-list');
  list.innerHTML = '';

  for (let i = 0; i < setupPlayerCount; i++) {
    const existing = state.players[i];
    const row = document.createElement('div');
    row.className = 'player-setup-row';
    row.innerHTML = `
      <span style="font-size:8px;color:#556;min-width:14px;">${i+1}</span>
      <input type="text" id="pname-${i}" value="${existing ? existing.name : 'Player ' + (i+1)}"
             maxlength="12" placeholder="Player ${i+1}" />
      <div class="color-pip-group" id="pcolor-${i}">
        ${MTG_COLORS.map(c => `
          <div class="color-pip pip-${c} ${getSelectedColors(existing, i).includes(c) ? 'selected' : ''}"
               data-color="${c}" data-player="${i}"
               onclick="toggleColor(this)"
               title="${COLOR_LABELS[c]}"></div>
        `).join('')}
      </div>
    `;
    list.appendChild(row);
  }
}

function getSelectedColors(player, index) {
  if (player && player.colors) return player.colors;
  // Default color assignments
  const defaults = [['G'],['U'],['B'],['R'],['W'],['C']];
  return defaults[index] || ['C'];
}

function toggleColor(pip) {
  const playerIndex = parseInt(pip.dataset.player);
  const group = document.getElementById('pcolor-' + playerIndex);
  const selected = group.querySelectorAll('.selected');
  if (pip.classList.contains('selected')) {
    // Deselect only if more than 1 selected
    if (selected.length > 1) pip.classList.remove('selected');
  } else {
    if (selected.length < 2) pip.classList.add('selected');
    else {
      // Replace first selected
      selected[0].classList.remove('selected');
      pip.classList.add('selected');
    }
  }
}

function selectFormat(btn) {
  document.querySelectorAll('#format-group .btn-toggle').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  setupFormat = btn.dataset.value;
}

function adjustPlayerCount(delta) {
  setupPlayerCount = Math.max(1, Math.min(6, setupPlayerCount + delta));
  document.getElementById('player-count-display').textContent = setupPlayerCount;
  renderSetup();
}

function startGame() {
  const startLife = setupFormat === 'commander' ? 40 : 20;
  const players = [];

  for (let i = 0; i < setupPlayerCount; i++) {
    const name = document.getElementById('pname-' + i).value.trim() || 'Player ' + (i+1);
    const colorGroup = document.getElementById('pcolor-' + i);
    const colors = Array.from(colorGroup.querySelectorAll('.selected')).map(p => p.dataset.color);

    const commanderDamage = {};
    for (let j = 0; j < setupPlayerCount; j++) {
      if (j !== i) commanderDamage[j] = 0;
    }

    players.push({
      id: i,
      name,
      colors: colors.length ? colors : ['C'],
      life: startLife,
      poison: 0,
      commanderDamage,
      counters: [],   // [{label, value}]
      eliminated: false,
    });
  }

  state = {
    format: setupFormat,
    startingLife: startLife,
    playerCount: setupPlayerCount,
    players,
    turnOrder: players.map(p => p.id),
    currentTurnIndex: 0,
    history: [],
    lastExport: state.lastExport || null,
    gameStarted: true,
  };

  saveDB(state);
  showScreen('game');
  renderGame();
}

function newGame() {
  closeMenu();
  state.gameStarted = false;
  setupPlayerCount = state.playerCount;
  setupFormat = state.format;
  saveDB(state);
  renderSetup();
  showScreen('setup');
}

// ── Game Render ───────────────────────────────────────────────
function renderGame() {
  renderTurnHeader();
  renderPlayerGrid();
}

function renderTurnHeader() {
  const p = state.players[state.turnOrder[state.currentTurnIndex]];
  document.getElementById('current-turn-name').textContent = p ? p.name : '—';
}

function renderPlayerGrid() {
  const grid = document.getElementById('player-grid');
  grid.className = 'players-' + state.playerCount;
  grid.innerHTML = '';

  state.players.forEach(player => {
    grid.appendChild(buildPlayerCard(player));
  });
}

function buildPlayerCard(player) {
  const isCurrentTurn = state.turnOrder[state.currentTurnIndex] === player.id;
  const totalCmdDmg = Object.values(player.commanderDamage).reduce((a, b) => a + b, 0);
  const cmdWarning = Object.values(player.commanderDamage).some(v => v >= 15);
  const cmdDanger  = Object.values(player.commanderDamage).some(v => v >= 21);
  const lifeClass  = player.life <= 5 ? 'low' : '';

  const card = document.createElement('div');
  card.className = 'player-card' +
    (isCurrentTurn ? ' is-turn' : '') +
    (player.eliminated ? ' eliminated' : '');
  card.id = 'card-' + player.id;

  // Color bar
  const colorBar = buildColorBar(player.colors);

  card.innerHTML = `
    ${colorBar}
    <div class="player-card-header">
      <span class="player-name">${escHtml(player.name)}</span>
      <button class="btn-eliminate" onclick="toggleEliminate(${player.id})" title="Toggle eliminated">☠</button>
    </div>

    <div class="life-section">
      <div class="life-btn-group">
        <button class="btn-life large" onclick="changeLife(${player.id}, 10)">+10</button>
        <button class="btn-life" onclick="changeLife(${player.id}, 1)">+1</button>
      </div>

      <div class="life-display ${lifeClass}" id="life-${player.id}"
           onclick="editLife(${player.id})">${player.life}</div>

      <div class="life-btn-group">
        <button class="btn-life large" onclick="changeLife(${player.id}, -10)">−10</button>
        <button class="btn-life" onclick="changeLife(${player.id}, -1)">−1</button>
      </div>
    </div>

    <div class="card-stats">
      <div class="stat-chip" onclick="openCmdOverlay(${player.id})" title="Commander damage">
        <span class="stat-chip-label">CMD</span>
        <span class="stat-chip-val ${cmdDanger ? 'danger' : ''}">${totalCmdDmg}</span>
        <div class="stat-chip-btns"><span style="font-size:9px;color:#556;">▶</span></div>
      </div>

      <div class="stat-chip">
        <span class="stat-chip-label">PSN</span>
        <span class="stat-chip-val ${player.poison >= 8 ? 'danger' : ''}" id="poison-${player.id}">${player.poison}</span>
        <div class="stat-chip-btns">
          <button class="btn-tiny" onclick="changePoison(${player.id}, 1)">+</button>
          <button class="btn-tiny" onclick="changePoison(${player.id}, -1)">−</button>
        </div>
      </div>
    </div>
  `;

  return card;
}

function buildColorBar(colors) {
  if (!colors || !colors.length) return '<div class="player-color-bar"></div>';
  const colorVars = { W:'--w', U:'--u', B:'--b', R:'--r', G:'--g', C:'--c' };
  if (colors.length === 1) {
    return `<div class="player-color-bar" style="background:var(${colorVars[colors[0]] || '--c'})"></div>`;
  }
  return `<div class="player-color-bar" style="background:linear-gradient(90deg,var(${colorVars[colors[0]] || '--c'}) 50%,var(${colorVars[colors[1]] || '--c'}) 50%)"></div>`;
}

// ── Life ─────────────────────────────────────────────────────
function changeLife(playerId, delta) {
  const p = getPlayer(playerId);
  if (!p || p.eliminated) return;
  const prev = p.life;
  p.life = Math.max(-99, Math.min(999, p.life + delta));
  recordHistory(p, 'life', delta, prev, p.life);
  checkDeath(p);
  updatePlayerCard(p);
  saveDB(state);
}

function editLife(playerId) {
  const el = document.getElementById('life-' + playerId);
  const p = getPlayer(playerId);
  if (!p || p.eliminated) return;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'life-display editing';
  input.value = p.life;
  el.replaceWith(input);
  input.select();

  function commit() {
    const val = parseInt(input.value);
    if (!isNaN(val)) {
      const prev = p.life;
      p.life = Math.max(-99, Math.min(999, val));
      recordHistory(p, 'life', p.life - prev, prev, p.life);
      checkDeath(p);
      saveDB(state);
    }
    updatePlayerCard(p);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.replaceWith(el); }
  });
}

function checkDeath(p) {
  const cmdDeath = Object.values(p.commanderDamage).some(v => v >= 21);
  if ((p.life <= 0 || p.poison >= 10 || cmdDeath) && !p.eliminated) {
    p.eliminated = true;
    showToast('☠ ' + p.name + ' eliminated!');
  }
}

// ── Poison ───────────────────────────────────────────────────
function changePoison(playerId, delta) {
  const p = getPlayer(playerId);
  if (!p || p.eliminated) return;
  const prev = p.poison;
  p.poison = Math.max(0, Math.min(10, p.poison + delta));
  recordHistory(p, 'poison', delta, prev, p.poison);
  checkDeath(p);
  updatePlayerCard(p);
  saveDB(state);
}

// ── Commander Damage Overlay ──────────────────────────────────
let cmdOverlayTargetId = null;

function openCmdOverlay(playerId) {
  cmdOverlayTargetId = playerId;
  const p = getPlayer(playerId);
  document.getElementById('cmd-overlay-title').textContent = p.name + ' — CMD DMG';

  const list = document.getElementById('cmd-damage-list');
  list.innerHTML = '';

  state.players.forEach(attacker => {
    if (attacker.id === playerId) return;
    const dmg = p.commanderDamage[attacker.id] || 0;
    const row = document.createElement('div');
    row.className = 'cmd-dmg-row';
    const valClass = dmg >= 21 ? 'danger' : dmg >= 15 ? 'warning' : '';
    row.innerHTML = `
      <span class="cmd-dmg-name">${escHtml(attacker.name)}</span>
      <span class="cmd-dmg-val ${valClass}" id="cmdval-${playerId}-${attacker.id}">${dmg}</span>
      <div class="cmd-dmg-btns">
        <button class="btn-cmd" onclick="changeCmdDmg(${playerId},${attacker.id},1)">+</button>
        <button class="btn-cmd" onclick="changeCmdDmg(${playerId},${attacker.id},-1)">−</button>
      </div>
    `;
    list.appendChild(row);
  });

  document.getElementById('overlay-cmd').classList.remove('hidden');
}

function changeCmdDmg(targetId, sourceId, delta) {
  const p = getPlayer(targetId);
  if (!p) return;
  const prev = p.commanderDamage[sourceId] || 0;
  p.commanderDamage[sourceId] = Math.max(0, (p.commanderDamage[sourceId] || 0) + delta);
  const newVal = p.commanderDamage[sourceId];

  // Auto-apply to life total if increasing
  if (delta > 0) {
    const lifePrev = p.life;
    p.life = Math.max(-99, p.life - delta);
    recordHistory(p, 'life (cmd dmg from ' + getPlayer(sourceId).name + ')',
      -delta, lifePrev, p.life);
  }

  recordHistory(p, 'cmd-dmg from ' + getPlayer(sourceId).name, delta, prev, newVal);
  checkDeath(p);

  // Update overlay display
  const valEl = document.getElementById('cmdval-' + targetId + '-' + sourceId);
  if (valEl) {
    valEl.textContent = newVal;
    valEl.className = 'cmd-dmg-val' + (newVal >= 21 ? ' danger' : newVal >= 15 ? ' warning' : '');
  }

  updatePlayerCard(p);
  saveDB(state);
}

function closeCmdOverlay() {
  document.getElementById('overlay-cmd').classList.add('hidden');
  cmdOverlayTargetId = null;
}

// ── Eliminate ────────────────────────────────────────────────
function toggleEliminate(playerId) {
  const p = getPlayer(playerId);
  p.eliminated = !p.eliminated;
  updatePlayerCard(p);
  saveDB(state);
}

// ── Turn ─────────────────────────────────────────────────────
function nextTurn() {
  // Find next non-eliminated player
  const total = state.turnOrder.length;
  let attempts = 0;
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % total;
    attempts++;
  } while (
    state.players[state.turnOrder[state.currentTurnIndex]].eliminated &&
    attempts < total
  );

  renderTurnHeader();
  // Highlight current turn card
  document.querySelectorAll('.player-card').forEach(c => c.classList.remove('is-turn'));
  const activeId = state.turnOrder[state.currentTurnIndex];
  const card = document.getElementById('card-' + activeId);
  if (card) card.classList.add('is-turn');
  saveDB(state);
}

// ── Undo ─────────────────────────────────────────────────────
function undoLast() {
  if (!state.history.length) { showToast('Nothing to undo'); return; }
  const last = state.history.pop();
  const p = getPlayer(last.playerId);
  if (!p) return;

  if (last.field === 'life') {
    p.life = last.prevVal;
    p.eliminated = false;
  } else if (last.field === 'poison') {
    p.poison = last.prevVal;
    p.eliminated = false;
  } else if (last.field.startsWith('cmd-dmg')) {
    // re-extract source id from field string — just revert card
  }

  updatePlayerCard(p);
  saveDB(state);
  showToast('↩ Undone: ' + last.field + ' for ' + p.name);
}

// ── History ──────────────────────────────────────────────────
function recordHistory(player, field, delta, prevVal, newVal) {
  state.history.push({
    playerId: player.id,
    playerName: player.name,
    field,
    delta,
    prevVal,
    newVal,
    ts: Date.now(),
  });
  // Keep last 100 entries
  if (state.history.length > 100) state.history.shift();
}

function showHistory() {
  closeMenu();
  const list = document.getElementById('history-list');
  list.innerHTML = '';

  if (!state.history.length) {
    list.innerHTML = '<div class="history-entry"><span style="color:#556;font-family:var(--font-vt);font-size:18px;">No changes yet</span></div>';
  } else {
    [...state.history].reverse().slice(0, 50).forEach(h => {
      const entry = document.createElement('div');
      entry.className = 'history-entry';
      const sign = h.delta > 0 ? '+' : '';
      const cls = h.delta > 0 ? 'pos' : 'neg';
      const time = new Date(h.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      entry.innerHTML = `
        <span class="h-player">${escHtml(h.playerName)}</span>
        <span class="h-change ${cls}">${sign}${h.delta} ${h.field}</span>
        <span class="h-time">${time}</span>
      `;
      list.appendChild(entry);
    });
  }

  document.getElementById('overlay-history').classList.remove('hidden');
}

function closeHistory() {
  document.getElementById('overlay-history').classList.add('hidden');
}

// ── Menu ─────────────────────────────────────────────────────
function showMenu() {
  const status = document.getElementById('backup-status-display');
  if (state.lastExport) {
    const d = new Date(state.lastExport);
    status.textContent = 'Last backup: ' + d.toLocaleDateString();
    const daysSince = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) status.textContent += '\n⚠ Backup recommended';
  } else {
    status.textContent = 'No backup yet — export recommended';
  }
  document.getElementById('overlay-menu').classList.remove('hidden');
}

function closeMenu() {
  document.getElementById('overlay-menu').classList.add('hidden');
}

// ── Import / Export ──────────────────────────────────────────
function showImportExport() {
  closeMenu();
  document.getElementById('io-status').textContent = '';
  document.getElementById('overlay-io').classList.remove('hidden');
}

function closeImportExport() {
  document.getElementById('overlay-io').classList.add('hidden');
}

function triggerImport() {
  document.getElementById('import-file-input').click();
}

// ── Partial card update (no full re-render) ───────────────────
function updatePlayerCard(player) {
  const existing = document.getElementById('card-' + player.id);
  if (!existing) return;
  const newCard = buildPlayerCard(player);
  existing.replaceWith(newCard);
}

// ── Utilities ────────────────────────────────────────────────
function getPlayer(id) {
  return state.players.find(p => p.id === id);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}
