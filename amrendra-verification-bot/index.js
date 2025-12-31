const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;          // verification bot token
const FORCE_CHANNEL = process.env.FORCE_CHANNEL;  // channel username (without @)
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL) {
  throw new Error("Missing BOT_TOKEN or FORCE_CHANNEL");
}

// ===== FILE =====
const USERS_FILE = path.join(__dirname, "users.json");

// ===== RETURN MAP =====
const RETURN_BOTS = {
  exam_notify: "https://t.me/amrendra_exam_notify_bot",
  song_finder: "https://t.me/song_finder_bot"
};

// ===== HELPERS =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function saveVerifiedUser(userId, source) {
  const users = loadUsers();
  if (!users.find(u => u.user_id === userId && u.verified_for === source)) {
    users.push({
      user_id: userId,
      verified_for: source,
      verified: true,
      time: new Date().toISOString()
    });
    saveUsers(users);
  }
}

// ===== CHANNEL JOIN CHECK =====
async function isJoined(userId) {
  const data = await tg("getChatMember", {
    chat_id: `@${FORCE_CHANNEL}`,
    user_id: userId,
  });
  if (!data.ok) return false;
  return ["member", "administrator", "creator"].includes(data.result.status);
}

// ===== HEALTH =====
app.get("/", (_, res) => {
  res.send("Amrendra Verification Bot running");
});

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message && !update.callback_query) return res.send("ok");

    const msg = update.message || update.callback_query.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // ===== payload identify =====
    const startText = update.message?.text || "";
    const payload = startText.split(" ")[1] || "exam_notify";
    const returnUrl = RETURN_BOTS[payload];

    // ===== CALLBACK: I HAVE JOINED =====
    if (update.callback_query?.data === "check_join") {
      if (!(await isJoined(userId))) {
        await tg("answerCallbackQuery", {
          callback_query_id: update.callback_query.id,
          text: "Please join the channel first.",
          show_alert: true,
        });
        return res.send("ok");
      }

      saveVerifiedUser(userId, payload);

      await tg("sendMessage", {
        chat_id: chatId,
        text:
`✅ You are verified!

You can now continue using the bot.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "➡️ Go to Your Bot", url: returnUrl }]
          ]
        }
      });

      return res.send("ok");
    }

    // ===== FIRST ENTRY / START =====
    if (update.message && update.message.text.startsWith("/start")) {
      // User NOT joined
      if (!(await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          text:
`👋 Welcome!

Verification process has started.
Please complete the steps below to continue.`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔔 Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }]
            ]
          }
        });
        return res.send("ok");
      }

      // User JOINED
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`✅ Channel Joined

Click the button below to complete verification.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ I Have Joined", callback_data: "check_join" }]
          ]
        }
      });

      return res.send("ok");
    }

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log("Amrendra Verification Bot running on port", PORT);
});
