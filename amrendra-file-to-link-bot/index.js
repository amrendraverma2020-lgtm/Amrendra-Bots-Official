const express = require("express");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// ===== TELEGRAM SEND MESSAGE =====
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Amrendra File To Link Bot running");
});

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const chatId = msg.chat.id;

    // FILE DETECTION
    let fileSize = null;

    if (msg.document) fileSize = msg.document.file_size;
    else if (msg.video) fileSize = msg.video.file_size;
    else if (msg.audio) fileSize = msg.audio.file_size;

    if (!fileSize) {
      await sendMessage(chatId, "❌ No file detected.");
      return res.send("ok");
    }

    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);

    // SMART MODE
    if (fileSize >= 300 * 1024 * 1024) {
      await sendMessage(
        chatId,
        "🤖 Smart Download Mode Activated\n\n" +
        "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
        "💡 Tip: Fast browser downloads are available for smaller files to provide better speed."
      );
    } else {
      await sendMessage(
        chatId,
        "⚡ Fast Mode\n\n" +
        `📦 File Size: ${sizeMB} MB\n\n` +
        "🚀 Browser download support coming soon."
      );
    }

    return res.send("ok");
  } catch (err) {
    console.error("BOT ERROR:", err);
    return res.send("ok");
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Amrendra File To Link Bot running on port", PORT);
});
