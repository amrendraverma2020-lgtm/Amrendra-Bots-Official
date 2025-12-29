const express = require("express");
const app = express();

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// health check
app.get("/", (req, res) => {
  res.send("Amrendra File Bot running");
});

// helper
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

// webhook
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.send("ok");

    const chatId = msg.chat.id;

    // /start
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "👋 Welcome!\n\nSend any file and I’ll analyze the best download mode for you."
      );
      return res.send("ok");
    }

    // detect file
    const file =
      msg.document ||
      msg.video ||
      msg.audio;

    if (!file || !file.file_size) {
      await sendMessage(chatId, "❌ Please send a valid file.");
      return res.send("ok");
    }

    const sizeMB = (file.file_size / (1024 * 1024)).toFixed(1);

    if (file.file_size >= 300 * 1024 * 1024) {
      await sendMessage(
        chatId,
`🤖 Smart Download Mode Activated

📦 File Size: ${sizeMB} MB

To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.

💡 Tip: Fast browser downloads are available for smaller files.`
      );
    } else {
      await sendMessage(
        chatId,
`⚡ Fast Mode

📦 File Size: ${sizeMB} MB

This file is eligible for faster download options.

🚀 More features coming soon.`
      );
    }

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
