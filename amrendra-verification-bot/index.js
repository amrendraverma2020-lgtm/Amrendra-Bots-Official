const express = require("express");
const fetch = require("node-fetch");
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
// ⚠️ SAME DB as Master Bot
const DB_FILE = path.join(__dirname, "../central-db/users.json");

let DB = {
  users: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    DB = JSON.parse(fs.readFileSync(DB_FILE));
  } catch {}
}

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
  if (!data.ok) return false;
  return ["member", "administrator", "creator"].includes(data.result.status);
}

// ================= RETURN URL (DYNAMIC) =================
function getReturnUrl(payload) {
  return (
    process.env[`RETURN_${payload}`] ||
    process.env.RETURN_default ||
    "https://t.me"
  );
}

// ================= WEBHOOK =================
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    const cq = req.body.callback_query;

    // ================= MESSAGE =================
    if (msg && msg.text) {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const username = msg.from.username || "";
      const firstName = msg.from.first_name || "";

      const payload = msg.text.split(" ")[1] || "default";
      const returnUrl = getReturnUrl(payload);

      const user = DB.users[userId];

      // ===== ALREADY VERIFIED =====
      if (user?.verified && await isJoined(userId)) {
        await tg("sendMessage", {
          chat_id: chatId,
          text:
            "✅ *Already Verified*\n\nYou may continue.",
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➡️ Continue", url: returnUrl }]
            ]
          }
        });
        return res.send("ok");
      }

      // ===== NOT JOINED =====
      if (!(await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          text:
            "🔒 *Verification Required*\n\n" +
            "Join the official channel to continue.",
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔔 Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }],
              [{ text: "🔁 I have joined", callback_data: `recheck:${payload}` }]
            ]
          }
        });
        return res.send("ok");
      }

      // ===== VERIFIED (CENTRAL SAVE) =====
      DB.users[userId] = {
        id: userId,
        username,
        name: firstName,
        verified: true,
        bots: Array.from(new Set([...(user?.bots || []), payload])),
        blocked: user?.blocked || false,
        warnings: user?.warnings || 0,
        verified_at: Date.now()
      };

      saveDB();

      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "✅ *Verification Successful*\n\nYou may continue.",
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➡️ Continue to bot", url: returnUrl }]
          ]
        }
      });

      return res.send("ok");
    }

    // ================= CALLBACK =================
    if (cq) {
      const chatId = cq.message.chat.id;
      const userId = cq.from.id;

      if (cq.data.startsWith("recheck:")) {
        const payload = cq.data.split(":")[1] || "default";
        const returnUrl = getReturnUrl(payload);

        if (await isJoined(userId)) {
          const user = DB.users[userId] || {};

          DB.users[userId] = {
            id: userId,
            username: user.username || "",
            name: user.name || "",
            verified: true,
            bots: Array.from(new Set([...(user.bots || []), payload])),
            blocked: user.blocked || false,
            warnings: user.warnings || 0,
            verified_at: Date.now()
          };

          saveDB();

          await tg("sendMessage", {
            chat_id: chatId,
            text: "✅ *Verification Successful*",
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➡️ Continue", url: returnUrl }]
              ]
            }
          });
        } else {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "❌ Channel not joined yet.",
            show_alert: true
          });
        }
      }
    }

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Verification Bot — CENTRAL DB CONNECTED on port", PORT);
});
