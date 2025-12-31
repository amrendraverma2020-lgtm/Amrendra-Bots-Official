const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = process.env.FORCE_CHANNEL;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL) {
  throw new Error("Missing BOT_TOKEN or FORCE_CHANNEL");
}

// ================= CENTRAL DB =================
const DB_FILE = path.join(__dirname, "../central-db/users.json");

// auto-create central db
if (!fs.existsSync(DB_FILE)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
}

let DB = JSON.parse(fs.readFileSync(DB_FILE));
const saveDB = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));

// ================= TG HELPER =================
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ================= CHANNEL CHECK =================
async function isJoined(userId) {
  const data = await tg("getChatMember", {
    chat_id: `@${FORCE_CHANNEL}`,
    user_id: userId,
  });
  return (
    data.ok &&
    ["member", "administrator", "creator"].includes(data.result.status)
  );
}

// ================= RETURN URL =================
function getReturnUrl(payload) {
  return (
    process.env[`RETURN_${payload}`] ||
    process.env.RETURN_default ||
    "https://t.me"
  );
}

// ================= WEBHOOK =================
app.post("/", async (req, res) => {
  // IMPORTANT: reply immediately
  res.send("ok");

  try {
    const msg = req.body.message;
    const cq = req.body.callback_query;

    // ===== MESSAGE =====
    if (msg && msg.text) {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const payload = msg.text.split(" ")[1] || "default";
      const returnUrl = getReturnUrl(payload);

      if (!(await isJoined(userId))) {
        return tg("sendMessage", {
          chat_id: chatId,
          text: "🔒 Join channel to verify",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }],
              [{ text: "I Joined", callback_data: `recheck:${payload}` }],
            ],
          },
        });
      }

      DB.users[userId] = {
        id: userId,
        verified: true,
        bots: Array.from(
          new Set([...(DB.users[userId]?.bots || []), payload])
        ),
        blocked: false,
        warnings: DB.users[userId]?.warnings || 0,
        verified_at: Date.now(),
      };

      saveDB();

      return tg("sendMessage", {
        chat_id: chatId,
        text: "✅ Verification Successful",
        reply_markup: {
          inline_keyboard: [[{ text: "Continue", url: returnUrl }]],
        },
      });
    }

    // ===== CALLBACK =====
    if (cq && cq.data.startsWith("recheck:")) {
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id,
      });
    }
  } catch (e) {
    console.error("Verification bot error:", e);
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("✅ Verification Bot running on port", PORT);
});
