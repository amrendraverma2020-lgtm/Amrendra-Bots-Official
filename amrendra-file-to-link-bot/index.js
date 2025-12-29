const express = require("express");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// Health check
app.get("/", (req, res) => {
  res.send("Amrendra File To Link Bot running");
});

// Telegram sendMessage
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// Webhook
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.send("ok");

    const chatId = msg.chat.id;

    if (msg.document || msg.video || msg.audio) {
      const size =
        msg.document?.file_size ||
        msg.video?.file_size ||
        msg.audio?.file_size ||
        0;

      if (size >= 300 * 1024 * 1024) {
        await sendMessage(
          chatId,
          "🤖 Smart Download Mode Activated\n\n" +
          "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
          "💡 Tip: Fast browser downloads are available for smaller files to provide better speed."
        );
      } else {
        await sendMessage(
          chatId,
          "⚡ Fast Mode\n\nThis file is eligible for faster download options.\n\n🚀 More features coming soon."
        );
      }
    }

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

// Start server
app.listen(PORT, () => {
  console.log("Amrendra File To Link Bot running on port", PORT);
});
