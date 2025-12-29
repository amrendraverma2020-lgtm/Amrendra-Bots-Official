const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;   // Telegram Bot Token
const OWNER_ID = process.env.OWNER_ID;     // Your Telegram numeric ID
const PORT = process.env.PORT || 10000;

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Amrendra Support Bot is running");
});

// ===== SEND MESSAGE HELPER =====
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown"
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

    // ===== /start COMMAND =====
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "👋 *Welcome to Amrendra Support Bot* 🤖\n\n" +
        "Thank you for reaching out.\n\n" +
        "📝 You can send your:\n" +
        "• Queries\n" +
        "• Issues\n" +
        "• Feedback\n" +
        "• Suggestions\n\n" +
        "📩 Your message will be securely forwarded to the owner for review.\n\n" +
        "⏳ Please allow some time for a response."
      );
      return res.send("ok");
    }

    // Ignore other commands
    if (msg.text && msg.text.startsWith("/")) {
      return res.send("ok");
    }

    // ===== FORWARD MESSAGE TO OWNER =====
    let forwardText =
      "📩 *New Support Message*\n\n" +
      `👤 User: ${userName}\n` +
      `🆔 User ID: ${userId}\n\n`;

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

    // ===== CONFIRM TO USER =====
    await sendMessage(
      chatId,
      "✅ *Message Received Successfully*\n\n" +
      "Your message has been forwarded to the support team.\n\n" +
      "⏳ You will be notified once a response is available.\n" +
      "Thank you for your patience."
    );

    return res.send("ok");
  } catch (err) {
    console.error(err);
    return res.send("ok");
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Amrendra Support Bot running on port", PORT);
});
