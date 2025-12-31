const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = process.env.FORCE_CHANNEL; // without @
const PORT = process.env.PORT || 10000;

// ===== FILE =====
const VERIFIED_FILE = path.join(__dirname, "verified_users.json");

// ===== HELPERS =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function loadVerified() {
  try {
    return JSON.parse(fs.readFileSync(VERIFIED_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveVerified(userId) {
  const list = loadVerified();
  if (!list.includes(userId)) {
    list.push(userId);
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(list, null, 2));
  }
}

async function isJoined(userId) {
  const res = await tg("getChatMember", {
    chat_id: `@${FORCE_CHANNEL}`,
    user_id: userId,
  });
  if (!res.ok) return false;
  return ["member", "administrator", "creator"].includes(res.result.status);
}

// ===== HEALTH =====
app.get("/", (_, res) => {
  res.send("Amrendra Verification Bot running");
});

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.send("ok");

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Welcome
    await tg("sendMessage", {
      chat_id: chatId,
      text:
`👋 Welcome

Verification process has started.
Please wait while we check your eligibility.`,
    });

    // Check channel
    if (!(await isJoined(userId))) {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`❌ You are not verified yet.

To continue, please join the official channel
and then click the button below.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔔 Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }],
            [{ text: "✅ I Have Joined", callback_data: "recheck" }],
          ],
        },
      });
      return res.send("ok");
    }

    // Verified
    saveVerified(userId);

    await tg("sendMessage", {
      chat_id: chatId,
      text:
`✅ Verification Successful

You are now an eligible member.
You may return to the bot and continue.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "➡️ Go Back to Bot", url: "https://t.me/amrendra_exam_notify_bot" }],
        ],
      },
    });

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

app.listen(PORT, () => {
  console.log("Verification Bot running on port", PORT);
});
