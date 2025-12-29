const express = require("express");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN; // Telegram Bot Token
const PORT = process.env.PORT || 10000;

// ===== TELEGRAM API BASE =====
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ===== HEALTH CHECK (IMPORTANT) =====
app.get("/", (req, res) => {
  res.send("Amrendra File To Link Bot is running ✅");
});

// ===== SAFE SEND MESSAGE =====
async function sendMessage(chatId, text, markdown = false) {
  const payload = {
    chat_id: chatId,
    text: text,
  };

  if (markdown) {
    payload.parse_mode = "Markdown";
  }

  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ===== GET FILE PATH FROM TELEGRAM =====
async function getTelegramFile(fileId) {
  const res = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
  const data = await res.json();

  if (!data.ok || !data.result || !data.result.file_path) {
    return null;
  }

  return {
    file_path: data.result.file_path,
    file_size: data.result.file_size || 0,
  };
}

// ===== WEBHOOK HANDLER =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const chatId = msg.chat.id;

    // ===== START COMMAND =====
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "👋 *Welcome to Amrendra File To Link Bot* 📦\n\n" +
          "Send me any file (video / document / audio).\n\n" +
          "🤖 Smart Download Mode will automatically choose the best option for you.\n\n" +
          "📌 Large files → Telegram optimized\n" +
          "⚡ Smaller files → Faster options",
        true
      );
      return res.send("ok");
    }

    // ===== FILE DETECTION =====
    let file = null;

    if (msg.document) file = msg.document;
    else if (msg.video) file = msg.video;
    else if (msg.audio) file = msg.audio;

    if (!file) {
      await sendMessage(chatId, "❌ Please send a valid file (video / document / audio).");
      return res.send("ok");
    }

    const fileId = file.file_id;
    const fileSize = file.file_size || 0;

    // ===== FILE SIZE MESSAGE =====
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    await sendMessage(chatId, `📦 File detected\nSize: ${sizeMB} MB`);

    // ===== GET FILE PATH SAFELY =====
    const tgFile = await getTelegramFile(fileId);

    if (!tgFile) {
      await sendMessage(
        chatId,
        "⚠️ Unable to process this file right now.\nPlease try again later."
      );
      return res.send("ok");
    }

    // ===== SMART MODE LOGIC =====
    if (fileSize >= 300 * 1024 * 1024) {
      // 🔒 LOCKED SMART MESSAGE
      await sendMessage(
        chatId,
        "🤖 *Smart Download Mode Activated*\n\n" +
          "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
          "💡 Tip: Fast browser downloads are available for smaller files to provide better speed.",
        true
      );
    } else {
      await sendMessage(
        chatId,
        "⚡ *Fast Mode*\n\n" +
          "This file is eligible for faster download options.\n\n" +
          "🚀 More features coming soon.",
        true
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
