const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Amrendra File To Link Bot is running");
});

// ===== SEND MESSAGE =====
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const chatId = msg.chat.id;

    // /start
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "👋 Welcome to *Amrendra File To Link Bot*\n\n" +
        "📤 Send any file and I’ll analyze it for smart download options."
      );
      return res.send("ok");
    }

    // ===== FILE DETECTION =====
    let file = msg.document || msg.video || msg.audio;
    if (!file) {
      await sendMessage(chatId, "📎 Please send a file (video / audio / document).");
      return res.send("ok");
    }

    const sizeMB = (file.file_size / (1024 * 1024)).toFixed(1);

    // ===== SMART MODE MESSAGE (LOCKED) =====
    const smartMsg =
      "🤖 Smart Download Mode Activated\n\n" +
      "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
      "💡 Tip: Fast browser downloads are available for smaller files to provide better speed.";

    await sendMessage(
      chatId,
      `📦 File detected\nSize: ${sizeMB} MB\n\n${smartMsg}`
    );

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Amrendra File To Link Bot running on port", PORT);
});
