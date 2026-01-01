const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ================= ENV ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = process.env.FORCE_CHANNEL; // without @
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL) {
  throw new Error("BOT_TOKEN or FORCE_CHANNEL missing");
}

/* ================= CENTRAL DB ================= */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

if (!fs.existsSync(DB_FILE)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
}

let DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
DB.users = DB.users || {};

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ================= TG HELPER ================= */

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ================= CHANNEL CHECK ================= */

async function isJoined(userId) {
  try {
    const r = await tg("getChatMember", {
      chat_id: `@${FORCE_CHANNEL}`,
      user_id: userId
    });
    return r.ok && ["member","administrator","creator"].includes(r.result.status);
  } catch {
    return false;
  }
}

/* ================= RETURN URL ================= */

function getReturnUrl(payload) {
  return (
    process.env[`RETURN_${payload}`] ||
    process.env.RETURN_default ||
    "https://t.me"
  );
}

/* ================= WEBHOOK ================= */

app.post("/", async (req, res) => {
  res.send("ok");

  try {
    const msg = req.body.message;
    const cq = req.body.callback_query;

    /* -------- MESSAGE -------- */
    if (msg?.text) {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const payload = msg.text.split(" ")[1] || "default";
      const returnUrl = getReturnUrl(payload);

      const existing = DB.users[userId];

      // already verified
      if (existing?.verified && await isJoined(userId)) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🎉 *Verification Successful!*\n\n" +
            "✅ Status: ACTIVE\n" +
            "🧠 Synced with Master Control",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➡️ Continue", url: returnUrl }]
            ]
          }
        });
        return;
      }

      // not joined
      if (!(await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🔒 *Verification Required*\n\n" +
            "Join the official channel to continue.",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔔 Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }],
              [{ text: "🔁 I Have Joined", callback_data: `recheck:${payload}` }]
            ]
          }
        });
        return;
      }

      // save user
      DB.users[userId] = {
        id: userId,
        verified: true,
        bots: Array.from(new Set([...(existing?.bots || []), payload])),
        blocked: existing?.blocked || false,
        warnings: existing?.warnings || 0,
        verified_at: existing?.verified_at || Date.now()
      };

      saveDB();
      console.log("✅ USER SAVED:", userId);

      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text:
          "🎉 *Verification Successful!*\n\n" +
          "You can now continue safely.",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➡️ Continue", url: returnUrl }]
          ]
        }
      });
    }

    /* -------- CALLBACK -------- */
    if (cq?.data?.startsWith("recheck:")) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });

      const payload = cq.data.split(":")[1] || "default";
      const returnUrl = getReturnUrl(payload);
      const userId = cq.from.id;

      if (await isJoined(userId)) {
        const old = DB.users[userId] || {};

        DB.users[userId] = {
          id: userId,
          verified: true,
          bots: Array.from(new Set([...(old.bots || []), payload])),
          blocked: old.blocked || false,
          warnings: old.warnings || 0,
          verified_at: old.verified_at || Date.now()
        };

        saveDB();

        await tg("sendMessage", {
          chat_id: cq.message.chat.id,
          text: "✅ Verification complete.",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➡️ Continue", url: returnUrl }]
            ]
          }
        });
      }
    }
  } catch (e) {
    console.error("VERIFY BOT ERROR:", e);
  }
});

app.listen(PORT, () =>
  console.log("✅ Verification Bot LIVE on", PORT)
);
