/**
 * ============================================================
 * AMRENDRA VERIFICATION BOT — FINAL STABLE BUILD
 * ============================================================
 * Purpose:
 * - Central verification gateway
 * - Saves users into CENTRAL DB
 * - Enforces channel join
 * - Returns user to original bot
 * - Fully compatible with Master Bot
 *
 * STATUS: ✅ PRODUCTION READY (RENDER SAFE)
 * ============================================================
 */

const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ============================================================
   ENVIRONMENT VARIABLES
   ============================================================ */

const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = process.env.FORCE_CHANNEL; // without @
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL) {
  throw new Error("❌ BOT_TOKEN or FORCE_CHANNEL missing");
}

/* ============================================================
   CENTRAL DATABASE (SHARED WITH MASTER BOT)
   ============================================================ */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

let DB = { users: {} };

// 🔥 Ensure DB exists
try {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
  } else {
    DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }
} catch (err) {
  console.error("❌ DB INIT ERROR:", err);
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ============================================================
   TELEGRAM API HELPER
   ============================================================ */

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ============================================================
   CHANNEL JOIN CHECK
   ============================================================ */

async function isJoined(userId) {
  try {
    const res = await tg("getChatMember", {
      chat_id: `@${FORCE_CHANNEL}`,
      user_id: userId
    });

    if (!res.ok) return false;

    return ["member", "administrator", "creator"].includes(
      res.result.status
    );
  } catch {
    return false;
  }
}

/* ============================================================
   RETURN URL HANDLER
   ============================================================ */

function getReturnUrl(payload) {
  return (
    process.env[`RETURN_${payload}`] ||
    process.env.RETURN_default ||
    "https://t.me"
  );
}

/* ============================================================
   WEBHOOK HANDLER (CRITICAL SECTION)
   ============================================================ */

app.post("/", async (req, res) => {
  // 🔥 MUST RESPOND IMMEDIATELY (Telegram Rule)
  res.send("ok");

  try {
    const msg = req.body.message;
    const cq = req.body.callback_query;

    /* ========================================================
       MESSAGE HANDLER
       ======================================================== */
    if (msg && msg.text) {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const username = msg.from.username || "";
      const firstName = msg.from.first_name || "";

      const payload = msg.text.split(" ")[1] || "default";
      const returnUrl = getReturnUrl(payload);

      const existingUser = DB.users[userId];

      /* ---------- ALREADY VERIFIED ---------- */
      if (existingUser?.verified && await isJoined(userId)) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🎉 *Verification Successful!*\n\n" +
            "Your identity has been securely verified.\n\n" +
            "✅ Status: *ACTIVE*\n" +
            "🧠 System: *Synced with Master Control*\n\n" +
            "You can now continue safely.",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➡️ Continue to Bot", url: returnUrl }]
            ]
          }
        });
        return;
      }

      /* ---------- NOT JOINED ---------- */
      if (!(await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🔒 *Verification Required*\n\n" +
            "To protect our system, joining the official channel is mandatory.\n\n" +
            "📢 Channel: @" + FORCE_CHANNEL + "\n\n" +
            "After joining, click *I Have Joined* below.",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🔔 Join Official Channel",
                  url: `https://t.me/${FORCE_CHANNEL}`
                }
              ],
              [
                {
                  text: "🔁 I Have Joined",
                  callback_data: `recheck:${payload}`
                }
              ]
            ]
          }
        });
        return;
      }

      /* ---------- VERIFIED & SAVE ---------- */
      DB.users[userId] = {
        id: userId,
        username,
        name: firstName,
        verified: true,
        bots: Array.from(
          new Set([...(existingUser?.bots || []), payload])
        ),
        blocked: existingUser?.blocked || false,
        warnings: existingUser?.warnings || 0,
        verified_at: Date.now()
      };

      saveDB();

      console.log("✅ USER SAVED:", DB.users[userId]);

      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text:
          "🎉 *Verification Successful!*\n\n" +
          "Your identity has been securely verified.\n\n" +
          "✅ Status: *ACTIVE*\n" +
          "🧠 System: *Synced with Master Control*\n\n" +
          "You can now continue safely.",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➡️ Continue to Bot", url: returnUrl }]
          ]
        }
      });
      return;
    }

    /* ========================================================
       CALLBACK HANDLER
       ======================================================== */
    if (cq) {
      // 🔥 VERY IMPORTANT
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id
      });

      const chatId = cq.message.chat.id;
      const userId = cq.from.id;

      if (cq.data.startsWith("recheck:")) {
        const payload = cq.data.split(":")[1] || "default";
        const returnUrl = getReturnUrl(payload);

        if (await isJoined(userId)) {
          const oldUser = DB.users[userId] || {};

          DB.users[userId] = {
            id: userId,
            username: oldUser.username || "",
            name: oldUser.name || "",
            verified: true,
            bots: Array.from(
              new Set([...(oldUser.bots || []), payload])
            ),
            blocked: oldUser.blocked || false,
            warnings: oldUser.warnings || 0,
            verified_at: Date.now()
          };

          saveDB();

          console.log("✅ USER VERIFIED VIA CALLBACK:", DB.users[userId]);

          await tg("sendMessage", {
            chat_id: chatId,
            parse_mode: "Markdown",
            text:
              "🎉 *Verification Successful!*\n\n" +
              "Your identity has been securely verified.\n\n" +
              "You can now continue safely.",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➡️ Continue to Bot", url: returnUrl }]
              ]
            }
          });
        } else {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            show_alert: true,
            text: "❌ Channel not joined yet."
          });
        }
      }
    }
  } catch (err) {
    console.error("❌ VERIFICATION BOT ERROR:", err);
  }
});

/* ============================================================
   SERVER START
   ============================================================ */

app.listen(PORT, () => {
  console.log(
    "✅ VERIFICATION BOT LIVE | CENTRAL DB CONNECTED | PORT:",
    PORT
  );
});
