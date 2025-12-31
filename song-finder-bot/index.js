const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN");
}

// ===== Telegram helper =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ===== Health check =====
app.get("/", (req, res) => {
  res.send("Song Finder Bot is running");
});

// ===== Webhook =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.send("ok");

    const chatId = msg.chat.id;
    const query = msg.text.trim();

    // /start
    if (query === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "🎵 *Song Finder Bot*\n\n" +
          "Type any song name, lyrics line, or artist.\n" +
          "Get one-tap links to listen instantly.",
        parse_mode: "Markdown",
      });
      return res.send("ok");
    }

    // Build search URLs (safe, legal, no API keys)
    const q = encodeURIComponent(query);
    const yt = `https://www.youtube.com/results?search_query=${q}`;
    const sp = `https://open.spotify.com/search/${q}`;
    const ytm = `https://music.youtube.com/search?q=${q}`;

    await tg("sendMessage", {
      chat_id: chatId,
      text: `🎧 *Results for:* _${query}_\n\nTap a platform to listen:`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ YouTube", url: yt }],
          [{ text: "🎧 Spotify", url: sp }],
          [{ text: "🎶 YouTube Music", url: ytm }],
        ],
      },
    });

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log("Song Finder Bot running on port", PORT);
});
