const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// webhook endpoint
app.post("/", async (req, res) => {
  const update = req.body;
  if (!update.message) return res.send("ok");

  const msg = update.message;
  const chatId = msg.chat.id;

  // DOCUMENT
  if (msg.document) {
    await send(chatId,
      `📄 Document detected\nSize: ${msg.document.file_size} bytes`
    );
  }

  // AUDIO
  else if (msg.audio) {
    await send(chatId,
      `🎵 Audio detected\nSize: ${msg.audio.file_size} bytes`
    );
  }

  // VIDEO
  else if (msg.video) {
    await send(chatId,
      `🎬 Video detected\nSize: ${msg.video.file_size} bytes`
    );
  }

  else {
    await send(chatId, "❌ No file detected");
  }

  res.send("ok");
});

// helper
async function send(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}

// health
app.get("/", (_, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log("Test bot running");
});
