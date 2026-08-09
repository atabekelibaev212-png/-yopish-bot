const { Telegraf, Markup } = require('telegraf');

function initBot({ token, webAppUrl, db, adminIds }) {
  const bot = new Telegraf(token);

  function mainKeyboard() {
    return Markup.keyboard([
      [Markup.button.webApp('🎮 Mini App ochish', webAppUrl || 'https://example.com')]
    ]).resize();
  }

  bot.start((ctx) => {
    const user = db.getUser(ctx.from.id, {
      username: ctx.from.username || '',
      firstName: ctx.from.first_name || ''
    });

    const payload = ctx.startPayload; // referral kod bo'lishi mumkin
    if (payload && !user.invitedBy) {
      const data = db.load();
      const inviter = Object.values(data.users).find(u => u.inviteCode === payload && u.id !== String(ctx.from.id));
      if (inviter) {
        const REFERRAL_BONUS = 500;
        user.invitedBy = inviter.id;
        user.coins += REFERRAL_BONUS;
        inviter.coins += REFERRAL_BONUS;
        inviter.referrals.push(user.id);
        data.users[user.id] = user;
        data.users[inviter.id] = inviter;
        db.save(data);
      }
    }

    ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name}! 👋\n\n` +
      `Yopish coin ilovasiga xush kelibsiz.\nTangalar yig'ing, skinlar sotib oling, do'stlaringizni taklif qiling va shashka o'ynang!\n\n` +
      `Boshlash uchun pastdagi tugmani bosing 👇`,
      mainKeyboard()
    );
  });

  bot.help((ctx) => {
    ctx.reply('Mini App ni ochish uchun /start buyrug\'ini yuboring yoki pastdagi tugmani bosing.');
  });

  // Admin buyruqlari (matnli, tezkor boshqaruv uchun)
  bot.command('admin', (ctx) => {
    if (!adminIds.includes(String(ctx.from.id))) return;
    const data = db.load();
    const users = Object.values(data.users);
    const totalCoins = users.reduce((s, u) => s + u.coins, 0);
    ctx.reply(
      `📊 Bot statistikasi\n\n` +
      `Foydalanuvchilar: ${users.length}\n` +
      `Umumiy tangalar: ${totalCoins}\n` +
      `Vazifalar: ${data.tasks.length}\n` +
      `Auksionlar: ${data.auctions.length}\n\n` +
      `To'liq boshqaruv uchun Mini App ichidagi Admin panelidan foydalaning (faqat sizga ko'rinadi).`
    );
  });

  bot.command('setdailycode', (ctx) => {
    if (!adminIds.includes(String(ctx.from.id))) return;
    const code = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!code) return ctx.reply('Foydalanish: /setdailycode YANGIKOD');
    const data = db.load();
    data.dailyBonusCode = code;
    db.save(data);
    ctx.reply(`✅ Kunlik bonus kodi yangilandi: ${code}`);
  });

  bot.launch();
  console.log('Telegram bot ishga tushdi (polling)');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

module.exports = { initBot };
