// Oddiy fayl-asosli baza (native modul talab qilmaydi, o'rnatish oson)
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function defaultData() {
  return {
    users: {},          // telegramId -> user object
    tasks: [],           // vazifalar ro'yxati
    shopItems: [
      { id: 'classic', name: 'Classic Gold', priceCoins: 0, multiplier: 1, dailyCap: 500, img: '/img/classic.png', locked: false },
      { id: 'nezuko', name: 'Nezuko', priceCoins: 15000, multiplier: 2, dailyCap: 500, img: '/img/nezuko.png', locked: false },
      { id: 'naruto', name: 'Naruto', priceCoins: 25000, multiplier: 2, dailyCap: 500, img: '/img/naruto.png', locked: false },
      { id: 'hinata', name: 'Hinata', priceCoins: 60000, multiplier: 3, dailyCap: 800, img: '/img/hinata.png', locked: false },
      { id: 'itachi', name: 'Itachi', priceCoins: 90000, multiplier: 3, dailyCap: 800, img: '/img/itachi.png', locked: false },
      { id: 'levi', name: 'Levi', priceCoins: 150000, multiplier: 5, dailyCap: 1000, img: '/img/levi.png', locked: false },
      { id: 'mitsuri', name: 'Mitsuri', priceCoins: 150000, multiplier: 5, dailyCap: 1000, img: '/img/mitsuri.png', locked: false },
      { id: 'mikasa', name: 'Mikasa', priceCoins: 400000, multiplier: 10, dailyCap: 5000, img: '/img/mikasa.png', locked: false },
      { id: 'gojo', name: 'Gojo', priceCoins: 400000, multiplier: 10, dailyCap: 5000, img: '/img/gojo.png', locked: false }
    ],
    auctions: [],         // auksion e'lonlari
    checkersGames: {},    // shashka o'yinlari
    dailyBonusCode: 'UZB2026',
    settings: {
      coinsPerTap: 1,
      maxEnergy: 500,
      energyRegenPerMin: 1
    }
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('DB parse error, resetting to default', e);
    save(defaultData());
    return defaultData();
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Har bir yozish/o'qishda faylni qayta yuklab, keyin saqlaymiz (kichik loyihalar uchun yetarli)
function getUser(telegramId, initData = {}) {
  const data = load();
  const key = String(telegramId);
  if (!data.users[key]) {
    data.users[key] = {
      id: key,
      username: initData.username || '',
      firstName: initData.firstName || '',
      coins: 0,
      diamondsRemoved: true, // haqiqiy pul/olmos tizimi olib tashlangan
      energy: data.settings.maxEnergy,
      maxEnergy: data.settings.maxEnergy,
      lastEnergyUpdate: Date.now(),
      skin: 'classic',
      ownedSkins: ['classic'],
      inviteCode: genInviteCode(key),
      invitedBy: null,
      referrals: [],
      completedTasks: [],
      lastDailyBonusClaim: null,
      stats: { games: 0, wins: 0, losses: 0 },
      createdAt: Date.now(),
      banned: false
    };
    save(data);
  }
  return data.users[key];
}

function genInviteCode(seed) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  let n = parseInt(seed, 10) || Date.now();
  for (let i = 0; i < 6; i++) {
    n = (n * 9301 + 49297) % 233280;
    out += chars[n % chars.length];
  }
  return out;
}

function updateUser(telegramId, patch) {
  const data = load();
  const key = String(telegramId);
  if (!data.users[key]) return null;
  data.users[key] = { ...data.users[key], ...patch };
  save(data);
  return data.users[key];
}

function regenEnergy(user, settings) {
  const now = Date.now();
  const minutesPassed = (now - user.lastEnergyUpdate) / 60000;
  if (minutesPassed <= 0) return user;
  const regen = Math.floor(minutesPassed * settings.energyRegenPerMin);
  if (regen > 0) {
    user.energy = Math.min(user.maxEnergy, user.energy + regen);
    user.lastEnergyUpdate = now;
  }
  return user;
}

module.exports = {
  load,
  save,
  getUser,
  updateUser,
  regenEnergy,
  defaultData
};
