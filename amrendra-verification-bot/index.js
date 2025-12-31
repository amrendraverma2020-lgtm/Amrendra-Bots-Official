const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;          // verify bot token
const FORCE_CHANNEL = process.env.FORCE_CHANNEL;  // without @
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL) {
  throw new Error("Missing BOT_TOKEN or FORCE_CHANNEL");
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

// ===== Return mapping (FINAL) =====
// payload -> where to return after verification
const RETURN_BOTS = {
  alerts: "https://t.me/amrendra_exam_notify_bot"
};

// ===== Join check =====
async function isJoined(userId) {
  const data = await tg("getChatMember", {
    chat_id: `@${FORCE_CHANNEL}`,
    user_id: userId,
  });
  if (!data.ok) return false;
  return ["member", "administrator", "creator"].includes(data.result.status);
}

// ===== Webhook =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.send("ok");

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // payload example: /start alerts
    const payload = msg.text.split(" ")[1] || "alerts";
    const returnUrl = RETURN_BOTS[payload];

    // Not joined
    if (!(await isJoined(userId))) {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "🔒 Access restricted.\n\n" +
          "Please join the channel to verify access.",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔔 Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }],
            [{ text: "🔁 Check Again", callback_data: "recheck" }],
          ],
        },
      });
      return res.send("ok");
    }

    // Verified
    await tg("sendMessage", {
      chat_id: chatId,
      text: "✅ Access Verified",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➡️ Continue", url: returnUrl }],
        ],
      },
    });

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log("Amrendra Verification Bot running on port", PORT);
});
