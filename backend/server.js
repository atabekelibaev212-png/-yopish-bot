require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const db = require('./db');
const { initBot } = require('./bot');
const { initCheckers } = require('./checkers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const BOT_TOKEN = process.env.BOT_TOKEN;

// ---------- Telegram initData tekshirish (xavfsizlik) ----------
// Mini App dan kelgan so'rovlar Telegram.WebApp.initData ni yuborishi kerak.
// Bu funksiya initData imzosini BOT_TOKEN bilan tekshiradi, soxta so'rovlarning oldini oladi.
function verifyInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckArr = [];
    for (const [key, value] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dataCheckArr.push(`${key}=${value}`);
    }
    const dataCheckString = dataCheckArr.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN || '').digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) return null;
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

// Har bir so'rovda foydalanuvchini aniqlaydigan middleware
function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.body.initData;
  const devId = req.headers['x-dev-user-id']; // faqat lokal test uchun (BOT_TOKEN bo'lmasa)

  let tgUser = verifyInitData(initData);
  if (!tgUser && !BOT_TOKEN && devId) {
    // Ishlab chiquvchi rejimi: BOT_TOKEN sozlanmagan bo'lsa, test uchun ID beriladi
    tgUser = { id: devId, username: 'dev', first_name: 'Dev' };
  }
  if (!tgUser) {
    return res.status(401).json({ error: 'Telegram orqali autentifikatsiyadan o\'ting' });
  }
  req.tgUser = tgUser;
  next();
}

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

// ---------- Foydalanuvchi holati ----------
app.post('/api/me', authMiddleware, (req, res) => {
  const data = db.load();
  const settings = data.settings;
  let user = db.getUser(req.tgUser.id, {
    username: req.tgUser.username || '',
    firstName: req.tgUser.first_name || ''
  });
  user = db.regenEnergy(user, settings);
  db.updateUser(user.id, user);
  res.json({ user, isAdmin: isAdmin(user.id), settings });
});

// ---------- Tap (bosish) ----------
app.post('/api/tap', authMiddleware, (req, res) => {
  const { taps = 1 } = req.body;
  const data = db.load();
  let user = db.getUser(req.tgUser.id);
  user = db.regenEnergy(user, data.settings);

  const skin = data.shopItems.find(s => s.id === user.skin) || data.shopItems[0];
  const validTaps = Math.max(0, Math.min(taps, user.energy));
  const earned = validTaps * skin.multiplier;

  user.energy -= validTaps;
  user.coins += earned;
  user.lastEnergyUpdate = Date.now();

  db.updateUser(user.id, user);
  res.json({ coins: user.coins, energy: user.energy, earned });
});

// ---------- Do'kon ----------
app.get('/api/shop', authMiddleware, (req, res) => {
  const data = db.load();
  res.json({ items: data.shopItems });
});

app.post('/api/shop/buy', authMiddleware, (req, res) => {
  const { itemId } = req.body;
  const data = db.load();
  const item = data.shopItems.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  let user = db.getUser(req.tgUser.id);
  if (user.ownedSkins.includes(itemId)) {
    user.skin = itemId;
    db.updateUser(user.id, user);
    return res.json({ ok: true, user, message: 'Skin faollashtirildi' });
  }
  if (user.coins < item.priceCoins) {
    return res.status(400).json({ error: 'Tanga yetarli emas' });
  }
  user.coins -= item.priceCoins;
  user.ownedSkins.push(itemId);
  user.skin = itemId;
  db.updateUser(user.id, user);
  res.json({ ok: true, user, message: 'Xarid muvaffaqiyatli' });
});

// ---------- Vazifalar ----------
app.get('/api/tasks', authMiddleware, (req, res) => {
  const data = db.load();
  const user = db.getUser(req.tgUser.id);
  const tasks = data.tasks.map(t => ({ ...t, completed: user.completedTasks.includes(t.id) }));
  res.json({ tasks });
});

app.post('/api/tasks/claim', authMiddleware, (req, res) => {
  const { taskId } = req.body;
  const data = db.load();
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'Vazifa topilmadi' });
  let user = db.getUser(req.tgUser.id);
  if (user.completedTasks.includes(taskId)) {
    return res.status(400).json({ error: 'Vazifa allaqachon bajarilgan' });
  }
  user.completedTasks.push(taskId);
  user.coins += task.rewardCoins;
  db.updateUser(user.id, user);
  res.json({ ok: true, user });
});

// Admin: vazifa yaratish (kanal/href turi)
app.post('/api/admin/tasks/create', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const { title, type, rewardCoins, link } = req.body;
  const data = db.load();
  const task = { id: nanoid(8), title, type: type || 'link', rewardCoins: Number(rewardCoins) || 0, link: link || '' };
  data.tasks.push(task);
  db.save(data);
  res.json({ ok: true, task });
});

app.post('/api/admin/tasks/delete', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const { taskId } = req.body;
  const data = db.load();
  data.tasks = data.tasks.filter(t => t.id !== taskId);
  db.save(data);
  res.json({ ok: true });
});

// ---------- Referral (Do'stlar) ----------
app.post('/api/referral/apply', authMiddleware, (req, res) => {
  const { code } = req.body;
  const data = db.load();
  let user = db.getUser(req.tgUser.id);
  if (user.invitedBy) return res.status(400).json({ error: 'Taklif kodi allaqachon ishlatilgan' });
  const inviter = Object.values(data.users).find(u => u.inviteCode === code && u.id !== user.id);
  if (!inviter) return res.status(404).json({ error: 'Kod topilmadi' });

  const REFERRAL_BONUS = 500;
  user.invitedBy = inviter.id;
  user.coins += REFERRAL_BONUS;
  inviter.coins += REFERRAL_BONUS;
  inviter.referrals.push(user.id);

  data.users[user.id] = user;
  data.users[inviter.id] = inviter;
  db.save(data);
  res.json({ ok: true, user });
});

// ---------- Kunlik bonus ----------
app.post('/api/daily-bonus/claim', authMiddleware, (req, res) => {
  const { code } = req.body;
  const data = db.load();
  let user = db.getUser(req.tgUser.id);
  const today = new Date().toDateString();
  if (user.lastDailyBonusClaim === today) {
    return res.status(400).json({ error: 'Bugungi bonus olingan, ertaga qayting' });
  }
  if (code !== data.dailyBonusCode) {
    return res.status(400).json({ error: 'Kod noto\'g\'ri' });
  }
  const BONUS = 100;
  user.coins += BONUS;
  user.lastDailyBonusClaim = today;
  db.updateUser(user.id, user);
  res.json({ ok: true, user, bonus: BONUS });
});

app.post('/api/admin/daily-bonus/set-code', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const { code } = req.body;
  const data = db.load();
  data.dailyBonusCode = code;
  db.save(data);
  res.json({ ok: true, code });
});

// ---------- Auksion ----------
app.get('/api/auction', authMiddleware, (req, res) => {
  const data = db.load();
  const now = Date.now();
  const active = data.auctions.filter(a => a.endsAt > now);
  const finished = data.auctions.filter(a => a.endsAt <= now);
  res.json({ active, finished });
});

app.post('/api/auction/create', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Faqat admin auksion yaratadi' });
  const { title, subtitle, startPrice, durationMinutes, img } = req.body;
  const data = db.load();
  const auction = {
    id: nanoid(8),
    title, subtitle: subtitle || '',
    img: img || '',
    currentPrice: Number(startPrice) || 0,
    bids: 0,
    highestBidder: null,
    endsAt: Date.now() + (Number(durationMinutes) || 60) * 60000
  };
  data.auctions.push(auction);
  db.save(data);
  res.json({ ok: true, auction });
});

app.post('/api/auction/bid', authMiddleware, (req, res) => {
  const { auctionId, amount } = req.body;
  const data = db.load();
  const auction = data.auctions.find(a => a.id === auctionId);
  if (!auction) return res.status(404).json({ error: 'Auksion topilmadi' });
  if (auction.endsAt <= Date.now()) return res.status(400).json({ error: 'Auksion yakunlangan' });
  const bidAmount = Number(amount);
  if (bidAmount <= auction.currentPrice) return res.status(400).json({ error: 'Taklif joriy narxdan yuqori bo\'lishi kerak' });

  let user = db.getUser(req.tgUser.id);
  if (user.coins < bidAmount) return res.status(400).json({ error: 'Tanga yetarli emas' });

  auction.currentPrice = bidAmount;
  auction.highestBidder = user.id;
  auction.bids += 1;
  db.save(data);
  res.json({ ok: true, auction });
});

// ---------- Admin: statistika va foydalanuvchilar ----------
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const data = db.load();
  const users = Object.values(data.users);
  res.json({
    totalUsers: users.length,
    totalCoins: users.reduce((s, u) => s + u.coins, 0),
    activeToday: users.filter(u => u.lastDailyBonusClaim === new Date().toDateString()).length,
    totalTasks: data.tasks.length,
    totalAuctions: data.auctions.length
  });
});

app.get('/api/admin/users', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const data = db.load();
  const users = Object.values(data.users)
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 200)
    .map(u => ({ id: u.id, username: u.username, firstName: u.firstName, coins: u.coins, banned: !!u.banned }));
  res.json({ users });
});

// Admin coin balansini sozlash (masalan xato/support holatlarida) — faqat in-game tanga, real pul emas
app.post('/api/admin/users/adjust-coins', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const { userId, delta } = req.body;
  const data = db.load();
  const user = data.users[String(userId)];
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  user.coins = Math.max(0, user.coins + Number(delta));
  db.save(data);
  res.json({ ok: true, user });
});

app.post('/api/admin/users/ban', authMiddleware, (req, res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  const { userId, banned } = req.body;
  const data = db.load();
  const user = data.users[String(userId)];
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  user.banned = !!banned;
  db.save(data);
  res.json({ ok: true, user });
});

// ---------- Shashka (checkers) - socket.io orqali ----------
initCheckers(io, db, ADMIN_IDS);

// ---------- Bot ----------
if (BOT_TOKEN) {
  initBot({ token: BOT_TOKEN, webAppUrl: process.env.WEBAPP_URL, db, adminIds: ADMIN_IDS });
} else {
  console.warn('BOT_TOKEN sozlanmagan — bot ishga tushmaydi, faqat API/Mini App test rejimida ishlaydi.');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Yopish server ${PORT}-portda ishga tushdi`);
});
