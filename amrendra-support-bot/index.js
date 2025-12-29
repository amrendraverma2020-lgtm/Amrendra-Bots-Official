const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("❌ BOT_TOKEN or OWNER_ID missing in environment variables");
}

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Amrendra Support Bot is running");
});

// ===== SEND MESSAGE FUNCTION =====
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

// ===== WEBHOOK HANDLER =====
app.post("/", async (req, res) => {
  console.log("🔔 Webhook hit received");

  try {
    const update = req.body;

    if (!update.message) {
      return res.send("ok");
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.username
      ? `@${msg.from.username}`
      : msg.from.first_name;

    // /start command
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "👋 Welcome to Amrendra Support Bot\n\n📝 Send your issue or query.\n📩 Your message will be sent to the owner."
      );
      return res.send("ok");
    }

    // Ignore other commands
    if (msg.text && msg.text.startsWith("/")) {
      return res.send("ok");
    }

    // Forward message to owner
    let forwardText =
      "📩 New Support Message\n\n" +
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
      "✅ Your message has been sent to support. Please wait for a reply."
    );

    return res.send("ok");
  } catch (err) {
    console.error("❌ Error:", err);
    return res.send("ok");
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log("Amrendra Support Bot running on port", PORT);
});
