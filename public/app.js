// ===================== Telegram WebApp init =====================
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

const initData = tg ? tg.initData : '';
const devUserId = new URLSearchParams(location.search).get('dev_id') || '111111'; // faqat lokal test uchun

let STATE = {
  user: null,
  isAdmin: false,
  settings: null,
  shopItems: [],
  tasks: [],
  auctionTab: 'active'
};

// ===================== API helper =====================
async function api(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData || '',
      'X-Dev-User-Id': devUserId
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');
  return data;
}
async function apiGet(path) {
  const res = await fetch(path, {
    headers: { 'X-Telegram-Init-Data': initData || '', 'X-Dev-User-Id': devUserId }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');
  return data;
}

// ===================== Navigation =====================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.screen));
});
document.querySelectorAll('.menu-item[data-target]').forEach(item => {
  item.addEventListener('click', () => showScreen(item.dataset.target));
});
document.getElementById('openAdminPanel').addEventListener('click', () => showScreen('screen-admin'));

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === id));

  if (id === 'screen-boost') loadShop();
  if (id === 'screen-tasks') loadTasks();
  if (id === 'screen-auction') loadAuction();
  if (id === 'screen-admin') loadAdmin();
}

// ===================== Load user / topbar =====================
async function refreshMe() {
  const { user, isAdmin, settings } = await api('/api/me');
  STATE.user = user; STATE.isAdmin = isAdmin; STATE.settings = settings;
  renderTop();
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }
  document.getElementById('myInviteCode').textContent = user.inviteCode;
  document.getElementById('statGames').textContent = user.stats.games;
  document.getElementById('statWins').textContent = user.stats.wins;
  document.getElementById('statLosses').textContent = user.stats.losses;
  document.getElementById('statRank').textContent = rankFor(user.stats.wins);
}

function rankFor(wins) {
  if (wins >= 50) return 'Master';
  if (wins >= 20) return 'Pro';
  if (wins >= 5) return 'Amateur';
  return 'Rookie';
}

function renderTop() {
  const u = STATE.user;
  document.getElementById('coinTop').textContent = fmt(u.coins);
  document.getElementById('coinCount').textContent = fmt(u.coins);
  document.getElementById('energyTop').textContent = u.energy;
  document.getElementById('energyMaxTop').textContent = u.maxEnergy;
  document.getElementById('energyNow').textContent = u.energy;
  document.getElementById('energyMax').textContent = u.maxEnergy;
  document.getElementById('energyFill').style.width = (u.energy / u.maxEnergy * 100) + '%';
  document.getElementById('profileCoins').textContent = fmt(u.coins) + ' 🪙';
  const item = STATE.shopItems.find(s => s.id === u.skin);
  document.getElementById('tapMultiplier').textContent = `Tap x${item ? item.multiplier : 1}`;
}

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ===================== TAP =====================
let tapBuffer = 0, tapFlushTimer = null;
document.getElementById('tapCoin').addEventListener('click', (e) => {
  if (STATE.user.energy <= 0) return;
  STATE.user.energy -= 1;
  STATE.user.coins += currentMultiplier();
  renderTop();
  spawnFloatingText(e, '+' + currentMultiplier());
  tapBuffer += 1;
  clearTimeout(tapFlushTimer);
  tapFlushTimer = setTimeout(flushTaps, 400);
});

function currentMultiplier() {
  const item = STATE.shopItems.find(s => s.id === STATE.user.skin);
  return item ? item.multiplier : 1;
}

async function flushTaps() {
  if (tapBuffer <= 0) return;
  const taps = tapBuffer; tapBuffer = 0;
  try {
    const res = await api('/api/tap', { taps });
    STATE.user.coins = res.coins;
    STATE.user.energy = res.energy;
    renderTop();
  } catch (e) { /* jim ignore */ }
}

function spawnFloatingText(e, text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:fixed; left:${e.clientX}px; top:${e.clientY}px; color:#ffe37a; font-weight:800; font-size:20px; pointer-events:none; z-index:999; transition: all .6s ease;`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'translateY(-60px)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 650);
}

// ===================== SHOP =====================
async function loadShop() {
  const { items } = await apiGet('/api/shop');
  STATE.shopItems = items;
  const list = document.getElementById('shopList');
  list.innerHTML = '';
  items.forEach(item => {
    const owned = STATE.user.ownedSkins.includes(item.id);
    const active = STATE.user.skin === item.id;
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = `
      <div class="placeholder-img">🪙</div>
      <div class="name">${item.name}</div>
      <div class="desc">x${item.multiplier} click • ${item.dailyCap} cap/day</div>
      <button class="btn ${active ? 'btn-green' : 'btn-yellow'}" data-id="${item.id}">
        ${active ? 'TANLANGAN' : (owned ? "FAOLLASHTIRISH" : fmt(item.priceCoins) + ' 🪙')}
      </button>
    `;
    div.querySelector('button').addEventListener('click', () => buyItem(item.id));
    list.appendChild(div);
  });
}

async function buyItem(itemId) {
  try {
    const res = await api('/api/shop/buy', { itemId });
    STATE.user = res.user;
    renderTop();
    loadShop();
  } catch (e) {
    alert(e.message);
  }
}

// ===================== TASKS =====================
async function loadTasks() {
  document.getElementById('dailyCodeInput').value = '';
  document.getElementById('dailyMsg').textContent = '';
  const { tasks } = await apiGet('/api/tasks');
  STATE.tasks = tasks;
  const list = document.getElementById('tasksList');
  list.innerHTML = '';
  if (tasks.length === 0) {
    list.innerHTML = '<p class="section-sub">Hozircha vazifalar yo\'q</p>';
  }
  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = 'task-item' + (t.completed ? ' done' : '');
    div.innerHTML = `
      <div>
        <div class="t-title">${t.title}</div>
        <div class="t-reward">+${t.rewardCoins} 🪙</div>
      </div>
      <button class="btn ${t.completed ? 'btn-gray' : 'btn-yellow'}" ${t.completed ? 'disabled' : ''}>${t.completed ? "BAJARILDI" : "BAJARISH"}</button>
    `;
    const btn = div.querySelector('button');
    btn.addEventListener('click', async () => {
      if (t.link) window.open(t.link, '_blank');
      try {
        const res = await api('/api/tasks/claim', { taskId: t.id });
        STATE.user = res.user;
        renderTop();
        loadTasks();
      } catch (e) { alert(e.message); }
    });
    list.appendChild(div);
  });
}

document.getElementById('claimDailyBtn').addEventListener('click', async () => {
  const code = document.getElementById('dailyCodeInput').value.trim();
  const msg = document.getElementById('dailyMsg');
  try {
    const res = await api('/api/daily-bonus/claim', { code });
    STATE.user = res.user;
    renderTop();
    msg.textContent = `✅ +${res.bonus} tanga qo'shildi!`;
    msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
    msg.className = 'msg err';
  }
});

document.getElementById('copyCodeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('myInviteCode').textContent);
});

document.getElementById('applyReferralBtn').addEventListener('click', async () => {
  const code = document.getElementById('friendCodeInput').value.trim().toUpperCase();
  const msg = document.getElementById('referralMsg');
  try {
    const res = await api('/api/referral/apply', { code });
    STATE.user = res.user;
    renderTop();
    msg.textContent = '✅ Kod qabul qilindi, +500 tanga!';
    msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
    msg.className = 'msg err';
  }
});

// ===================== AUCTION =====================
document.getElementById('auctionActiveTab').addEventListener('click', () => { STATE.auctionTab = 'active'; loadAuction(); });
document.getElementById('auctionFinishedTab').addEventListener('click', () => { STATE.auctionTab = 'finished'; loadAuction(); });

async function loadAuction() {
  document.getElementById('auctionActiveTab').classList.toggle('active', STATE.auctionTab === 'active');
  document.getElementById('auctionFinishedTab').classList.toggle('active', STATE.auctionTab === 'finished');
  document.getElementById('adminCreateAuction').style.display = STATE.isAdmin ? '' : 'none';

  const { active, finished } = await apiGet('/api/auction');
  const list = STATE.auctionTab === 'active' ? active : finished;
  const el = document.getElementById('auctionList');
  el.innerHTML = '';
  if (list.length === 0) el.innerHTML = '<p class="section-sub">Hozircha bo\'sh</p>';

  list.forEach(a => {
    const div = document.createElement('div');
    div.className = 'auction-item';
    const timeLeft = Math.max(0, a.endsAt - Date.now());
    div.innerHTML = `
      <div class="a-title">${a.title}</div>
      <div class="a-sub">${a.subtitle || ''}</div>
      <div class="a-price">${fmt(a.currentPrice)} 🪙 • ${a.bids} taklif</div>
      <div class="a-timer">${STATE.auctionTab === 'active' ? formatTime(timeLeft) : 'Yakunlangan'}</div>
      ${STATE.auctionTab === 'active' ? `
        <div class="bid-row">
          <input type="number" placeholder="Taklifingiz" id="bid-${a.id}" />
          <button class="btn btn-yellow" data-id="${a.id}">Taklif</button>
        </div>` : ''}
    `;
    if (STATE.auctionTab === 'active') {
      div.querySelector('button').addEventListener('click', async () => {
        const amount = document.getElementById(`bid-${a.id}`).value;
        try {
          await api('/api/auction/bid', { auctionId: a.id, amount });
          loadAuction();
        } catch (e) { alert(e.message); }
      });
    }
    el.appendChild(div);
  });
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

document.getElementById('aucCreateBtn').addEventListener('click', async () => {
  const title = document.getElementById('aucTitle').value.trim();
  const startPrice = document.getElementById('aucStart').value;
  const durationMinutes = document.getElementById('aucDuration').value;
  if (!title) return alert('Nomini kiriting');
  try {
    await api('/api/auction/create', { title, startPrice, durationMinutes });
    document.getElementById('aucTitle').value = '';
    document.getElementById('aucStart').value = '';
    document.getElementById('aucDuration').value = '';
    loadAuction();
  } catch (e) { alert(e.message); }
});

// ===================== ADMIN PANEL =====================
async function loadAdmin() {
  if (!STATE.isAdmin) return;
  const stats = await api('/api/admin/stats');
  document.getElementById('adminTotalUsers').textContent = stats.totalUsers;
  document.getElementById('adminTotalCoins').textContent = fmt(stats.totalCoins);
  document.getElementById('adminActiveToday').textContent = stats.activeToday;
  document.getElementById('adminTotalTasks').textContent = stats.totalTasks;

  const { users } = await api('/api/admin/users');
  const list = document.getElementById('adminUsersList');
  list.innerHTML = '';
  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'admin-user-row';
    div.innerHTML = `
      <div class="au-name">${u.firstName || u.username || u.id} — ${fmt(u.coins)} 🪙</div>
      <div class="au-actions">
        <button class="btn-icon" data-act="add">+100</button>
        <button class="btn-icon" data-act="sub">-100</button>
        <button class="btn-icon" data-act="ban">${u.banned ? '✅' : '🚫'}</button>
      </div>
    `;
    div.querySelector('[data-act="add"]').addEventListener('click', () => adjustCoins(u.id, 100));
    div.querySelector('[data-act="sub"]').addEventListener('click', () => adjustCoins(u.id, -100));
    div.querySelector('[data-act="ban"]').addEventListener('click', () => toggleBan(u.id, !u.banned));
    list.appendChild(div);
  });
}

async function adjustCoins(userId, delta) {
  try { await api('/api/admin/users/adjust-coins', { userId, delta }); loadAdmin(); }
  catch (e) { alert(e.message); }
}
async function toggleBan(userId, banned) {
  try { await api('/api/admin/users/ban', { userId, banned }); loadAdmin(); }
  catch (e) { alert(e.message); }
}

document.getElementById('adminSetCodeBtn').addEventListener('click', async () => {
  const code = document.getElementById('adminDailyCode').value.trim();
  if (!code) return;
  try {
    await api('/api/admin/daily-bonus/set-code', { code });
    alert('Kod yangilandi: ' + code);
    document.getElementById('adminDailyCode').value = '';
  } catch (e) { alert(e.message); }
});

document.getElementById('adminCreateTaskBtn').addEventListener('click', async () => {
  const title = document.getElementById('adminTaskTitle').value.trim();
  const link = document.getElementById('adminTaskLink').value.trim();
  const rewardCoins = document.getElementById('adminTaskReward').value;
  if (!title) return alert('Nomini kiriting');
  try {
    await api('/api/admin/tasks/create', { title, link, rewardCoins, type: 'link' });
    document.getElementById('adminTaskTitle').value = '';
    document.getElementById('adminTaskLink').value = '';
    document.getElementById('adminTaskReward').value = '';
    alert('Vazifa qo\'shildi');
  } catch (e) { alert(e.message); }
});

// ===================== CHECKERS (Shashka) =====================
let socket = null;
let currentGame = null;
let selectedCell = null;
let myPlayerNum = null;

function ensureSocket() {
  if (socket) return socket;
  socket = io('/checkers');
  socket.on('game_update', (game) => {
    currentGame = game;
    myPlayerNum = game.players.indexOf(String(STATE.user.id)) + 1;
    renderCheckersBoard();
  });
  return socket;
}

document.getElementById('createGameBtn').addEventListener('click', () => {
  ensureSocket();
  socket.emit('create_game', { userId: String(STATE.user.id) }, (res) => {
    if (!res.ok) return alert(res.error || 'Xatolik');
    joinRoomUI(res.gameId);
  });
});

document.getElementById('joinGameBtn').addEventListener('click', () => {
  const gameId = document.getElementById('joinGameId').value.trim().toUpperCase();
  if (!gameId) return;
  ensureSocket();
  socket.emit('join_game', { userId: String(STATE.user.id), gameId }, (res) => {
    if (!res.ok) return alert(res.error || 'Xatolik');
    currentGame = res.game;
    myPlayerNum = currentGame.players.indexOf(String(STATE.user.id)) + 1;
    joinRoomUI(gameId);
    renderCheckersBoard();
  });
});

function joinRoomUI(gameId) {
  document.getElementById('checkersLobby').style.display = 'none';
  document.getElementById('checkersBoardWrap').style.display = '';
  document.getElementById('gameIdLabel').textContent = 'Kod: ' + gameId;
}

document.getElementById('readyBtn').addEventListener('click', () => {
  if (!currentGame) return;
  socket.emit('ready', { gameId: currentGame.id, userId: String(STATE.user.id) });
});

document.getElementById('leaveGameBtn').addEventListener('click', () => {
  document.getElementById('checkersLobby').style.display = '';
  document.getElementById('checkersBoardWrap').style.display = 'none';
  currentGame = null; selectedCell = null;
});

function renderCheckersBoard() {
  const boardEl = document.getElementById('checkersBoard');
  boardEl.innerHTML = '';
  const g = currentGame;
  document.getElementById('turnLabel').textContent = g.winner
    ? (g.winner === myPlayerNum ? "🏆 Siz yutdingiz!" : "😢 Siz yutqazdingiz")
    : (g.turn === myPlayerNum ? "Sizning navbatingiz" : "Raqib navbati");

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      cell.className = 'cboard-cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
      cell.dataset.r = r; cell.dataset.c = c;
      const piece = g.board[r][c];
      if (piece) {
        const p = document.createElement('div');
        const isP1 = piece === 1 || piece === 3;
        p.className = 'piece ' + (isP1 ? 'p1' : 'p2') + ((piece === 3 || piece === 4) ? ' king' : '');
        cell.appendChild(p);
      }
      if (selectedCell && selectedCell[0] === r && selectedCell[1] === c) {
        cell.classList.add('selected');
      }
      cell.addEventListener('click', () => onCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

function onCellClick(r, c) {
  if (!currentGame || currentGame.winner) return;
  if (currentGame.turn !== myPlayerNum) return;
  const piece = currentGame.board[r][c];
  const isOwn = piece === myPlayerNum || piece === myPlayerNum + 2;

  if (selectedCell) {
    const [fr, fc] = selectedCell;
    if (fr === r && fc === c) { selectedCell = null; renderCheckersBoard(); return; }
    socket.emit('move', { gameId: currentGame.id, userId: String(STATE.user.id), from: [fr, fc], to: [r, c] }, (res) => {
      if (!res.ok) alert(res.error);
      selectedCell = null;
    });
    return;
  }
  if (isOwn) { selectedCell = [r, c]; renderCheckersBoard(); }
}

// ===================== BOOT =====================
(async function boot() {
  try {
    await refreshMe();
    await loadShop();
    renderTop();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;color:#fff">Xatolik: ${e.message}<br><br>Iltimos Mini App-ni Telegram ichida oching.</div>`;
  }
})();

// Har 30 sekundda energiya/coinni serverdan yangilab turish
setInterval(async () => {
  try {
    const { user } = await api('/api/me');
    STATE.user = user;
    renderTop();
  } catch (e) {}
}, 30000);
