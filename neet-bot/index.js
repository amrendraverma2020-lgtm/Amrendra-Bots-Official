/**
 * ==========================================
 * NEET ASPIRANTS BOT — BASE WORKING ENGINE
 * VERIFIED FOR:
 * - Render
 * - Telegram Webhook
 * - Node 18/22
 * ==========================================
 */

require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

/* ============ ENV ============ */
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

/* ============ TELEGRAM HELPER ============ */
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ============ HEALTH CHECK ============ */
app.get("/", (req, res) => {
  res.send("NEET Bot is running ✅");
});

/* ============ WEBHOOK ============ */
app.post("/", async (req, res) => {
  // VERY IMPORTANT — reply immediately
  res.send("ok");

  try {
    const update = req.body;
    if (!update.message) return;

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || "";

    /* ===== START ===== */
    if (text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to NEET Aspirants Bot

📚 This bot will help you with:
• Daily NEET-level practice
• Timed tests
• Leaderboards (coming soon)

⚠️ Note:
Bot may take 30–60 seconds to respond
if the server was sleeping.

✉️ You can now send a message 👇`
      });
      return;
    }

    /* ===== NORMAL MESSAGE ===== */
    await tg("sendMessage", {
      chat_id: chatId,
      text:
`✅ Message received!

Daily Biology Test system
is coming very soon 🚀

Stay tuned.`
    });

  } catch (err) {
    console.error("BOT ERROR:", err);
  }
});

/* ============ START SERVER ============ */
app.listen(PORT, () => {
  console.log("✅ NEET Bot running on port", PORT);
});
