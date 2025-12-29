const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== CONFIG (FROM ENV) =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("Missing BOT_TOKEN or OWNER_ID in environment variables");
}

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Amrendra Support Bot is running");
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

// ===== WEBHOOK HANDLER =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.username
      ? `@${msg.from.username}`
      : msg.from.first_name;

    // /start
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
`👋 Welcome to Amrendra Support Bot 🤖

📝 Send your issue, query, or feedback
📩 Your message will be forwarded to the owner
⏳ Please wait patiently for a response`
      );
      return res.send("ok");
    }

    // Ignore other commands
    if (msg.text && msg.text.startsWith("/")) {
      return res.send("ok");
    }

    // Forward message to owner
    let forwardText =
      `📩 New Support Message\n\n` +
      `👤 User: ${userName}\n` +
      `🆔 ID: ${userId}\n\n`;

    if (msg.text) {
      forwardText += `💬 Message:\n${msg.text}`;
    } else if (msg.photo) {
      forwardText += "📷 Photo received";
    } else if (msg.document) {
      forwardText += "📎 Document received";
    } else {
      forwardText += "📩 New message received";
    }

    await sendMessage(OWNER_ID, forwardText);

    // Acknowledge user
    await sendMessage(
      chatId,
      "✅ Your message has been sent to support.\nYou will receive a reply soon."
    );

    res.send("ok");
  } catch (err) {
    console.error(err);
    res.send("ok");
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Amrendra Support Bot running on port", PORT);
});
