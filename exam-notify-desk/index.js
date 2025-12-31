const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;          // main bot token
const VERIFY_BOT = "amrendra_verification_bot";  // verify bot username (no @)
const OWNER_ID = process.env.OWNER_ID;            // numeric telegram id
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("Missing BOT_TOKEN or OWNER_ID");
}

// ===== Telegram helper =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ===== Health =====
app.get("/", (req, res) => {
  res.send("Exam Notify Desk is running");
});

// ===== Webhook =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;

    // ===== /start =====
    if (update.message && update.message.text === "/start") {
      const chatId = update.message.chat.id;

      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "🔄 Verifying access...\n" +
          "Please wait a moment.",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔐 Verify Access",
              url: `https://t.me/${VERIFY_BOT}?start=alerts`
            }]
          ]
        }
      });
      return res.send("ok");
    }

    // ===== Admin broadcast =====
    // Usage: /send Your announcement text
    if (
      update.message &&
      update.message.text &&
      update.message.text.startsWith("/send")
    ) {
      const chatId = update.message.chat.id;
      if (String(chatId) !== String(OWNER_ID)) {
        return res.send("ok");
      }

      const text = update.message.text.replace("/send", "").trim();
      if (!text) {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "❌ Usage:\n/send <message>"
        });
        return res.send("ok");
      }

      // NOTE:
      // At scale, you will store verified user IDs.
      // For now, this bot sends only to the owner to keep logic final & safe.
      // (User storage will be added later WITHOUT changing verification flow.)

      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "📢 *Exam Notification*\n\n" + text,
        parse_mode: "Markdown"
      });

      return res.send("ok");
    }

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log("Exam Notify Desk running on port", PORT);
});
