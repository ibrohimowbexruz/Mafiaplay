# Mafia — Telegram Mini App (10 kishilik multiplayer)

## Loyihaning tuzilishi
```
mafia-game/
├── server/
│   ├── index.js      # Socket.io server, xona/o'yin oqimi
│   └── game.js        # O'yin mantig'i: rollar, tun/kun state machine
├── public/
│   ├── index.html      # Mini App UI
│   ├── style.css
│   └── app.js          # Client-side socket mantig'i
└── package.json
```

## Qanday ishlaydi
- **State machine**: `lobby → night → day → voting → result → (yana night yoki ended)`
- Har bir bosqich serverda avtomatik `setInterval` bilan hisoblanadi (timer), client faqat holatni ko'rsatadi
- **Rol filtri**: server har bir o'yinchiga faqat unga tegishli ma'lumotni yuboradi (`publicPlayerView`) — masalan mafia faqat o'z sheriklarini ko'radi, boshqalar mafia kimligini bilmaydi
- **10 kishi uchun**: 3 Mafia, 1 Komissar (detective), 1 Doktor, 5 Tinch aholi (`server/game.js` dagi `ROLE_SETUPS`)
- Kam odam bilan sinash uchun 4-9 kishilik variantlar ham qo'shilgan

## 1-qadam: Lokal ishga tushirish
```bash
cd mafia-game
npm install
npm start
```
Server `http://localhost:3000` da ishga tushadi.

## 2-qadam: Hostingga joylash
WebSocket qo'llab-quvvatlaydigan joy kerak (Vercel/Netlify **ishlamaydi**, chunki ular serverless):
- **Railway.app** (eng oson) — GitHub repo ulaysiz, avtomatik deploy
- **Render.com** — "Web Service" turi, `npm start` build command
- **Fly.io / VPS** — ham mos

Deploydan keyin sizga `https://your-app.up.railway.app` kabi HTTPS link beriladi (Telegram Mini App uchun HTTPS majburiy).

## 3-qadam: Telegram bot yaratish
1. Telegram'da **@BotFather** ga yozing
2. `/newbot` — bot nomi va username bering
3. `/newapp` — Mini App yaratish, hostingdagi HTTPS URL'ni bering
4. Bot menyusiga tugma qo'shish uchun: `/setmenubutton` → "🎮 O'ynash" → URL

`public/app.js` faylida quyidagi qatorni o'z bot username'ingizga almashtiring:
```js
const link = `https://t.me/YourBotName/mafia?startapp=${currentState.roomId}`;
```

## 4-qadam: Xonaga qo'shilish (deep link)
Do'stlar linkni bosganda (`?startapp=ROOMCODE`) `app.js` avtomatik shu kodni "Xona kodi" maydoniga qo'yadi — ular faqat ismini kiritib "Qo'shilish" tugmasini bosishadi.

## Kengaytirish g'oyalari
- Ovozli chat (Telegram WebApp hali buni to'liq qo'llab-quvvatlamaydi, lekin matnli chat ishlaydi)
- Qo'shimcha rollar: Maniac, Lover, Journalist
- Reconnect logikasi (hozircha chiqib ketgan o'yinchi "o'lgan" deb belgilanadi)
- Postgres/Redis bilan xonalarni saqlash (hozir RAM'da, server qayta ishga tushsa yo'qoladi)
