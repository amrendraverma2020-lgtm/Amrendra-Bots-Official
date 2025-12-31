/**
 * ============================================================
 * Amrendra Verification Bot
 * ------------------------------------------------------------
 * Purpose:
 * - Central verification gateway for all Amrendra bots
 * - Saves verified users in CENTRAL DB (shared with Master Bot)
 * - Enforces channel join before access
 * - Returns user back to original bot automatically
 *
 * Author: Amrendra
 * Status: Production Ready (Render Compatible)
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
  throw new Error("❌ BOT_TOKEN or FORCE_CHANNEL missing in environment");
}

/* ============================================================
   CENTRAL DATABASE (SHARED WITH MASTER BOT)
   ============================================================ */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

/**
 * DB structure:
 * {
 *   users: {
 *     userId: {
 *       id,
 *       username,
 *       name,
 *       verified,
 *       bots[],
 *       blocked,
 *       warnings,
 *       verified_at
 *     }
 *   }
 * }
 */

let DB = { users: {} };

try {
  if (fs.existsSync(DB_FILE)) {
    DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } else {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
  }
} catch (err) {
  console.error("❌ DB Load Error:", err);
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ============================================================
   TELEGRAM API HELPER
   ============================================================ */

async function tg(method, body) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

/* ============================================================
   CHANNEL MEMBERSHIP CHECK
   ============================================================ */

async function isJoined(userId) {
  try {
    const data = await tg("getChatMember", {
      chat_id: `@${FORCE_CHANNEL}`,
      user_id: userId,
    });

    if (!data.ok) return false;

    return ["member", "administrator", "creator"].includes(
      data.result.status
    );
  } catch {
    return false;
  }
}

/* ============================================================
   RETURN URL HANDLER (DYNAMIC – UNLIMITED BOTS)
   ============================================================ */

function getReturnUrl(payload) {
  return (
    process.env[`RETURN_${payload}`] ||
    process.env.RETURN_default ||
    "https://t.me"
  );
}

/* ============================================================
   WEBHOOK HANDLER
   ============================================================ */

app.post("/", async (req, res) => {
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

      // payload example: /start exam
      const payload = msg.text.split(" ")[1] || "default";
      const returnUrl = getReturnUrl(payload);

      const existingUser = DB.users[userId];

      /* ================= ALREADY VERIFIED ================= */
      if (existingUser?.verified && (await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "✅ *Verification Status: ACTIVE*\n\n" +
            "You are already verified in our system.\n\n" +
            "🔐 You have full access to all allowed services.\n\n" +
            "Tap the button below to continue where you came from 👇",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➡️ Continue", url: returnUrl }],
            ],
          },
        });
        return res.send("ok");
      }

      /* ================= NOT JOINED ================= */
      if (!(await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🔒 *Verification Required*\n\n" +
            "To protect our system from spam and abuse,\n" +
            "joining our official channel is mandatory.\n\n" +
            "📢 Channel: @" + FORCE_CHANNEL + "\n\n" +
            "👉 Join first, then click *I Have Joined*.",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🔔 Join Official Channel",
                  url: `https://t.me/${FORCE_CHANNEL}`,
                },
              ],
              [
                {
                  text: "🔁 I Have Joined",
                  callback_data: `recheck:${payload}`,
                },
              ],
            ],
          },
        });
        return res.send("ok");
      }

      /* ================= VERIFIED & SAVE ================= */
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
        verified_at: Date.now(),
      };

      saveDB();

      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text:
          "🎉 *Verification Successful!*\n\n" +
          "Your identity has been securely verified.\n\n" +
          "✅ Status: ACTIVE\n" +
          "🧠 System: Synced with Master Control\n\n" +
          "You can now continue safely.",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➡️ Continue to Bot", url: returnUrl }],
          ],
        },
      });

      return res.send("ok");
    }

    /* ========================================================
       CALLBACK HANDLER
       ======================================================== */
    if (cq) {
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
            verified_at: Date.now(),
          };

          saveDB();

          await tg("sendMessage", {
            chat_id: chatId,
            parse_mode: "Markdown",
            text:
              "✅ *Verification Completed*\n\n" +
              "Thank you for joining our channel.\n\n" +
              "You may now proceed safely.",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➡️ Continue", url: returnUrl }],
              ],
            },
          });
        } else {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            show_alert: true,
            text:
              "❌ Channel not joined yet.\n\n" +
              "Please join the channel first.",
          });
        }
      }
    }

    return res.send("ok");
  } catch (err) {
    console.error("❌ Runtime Error:", err);
    return res.send("ok");
  }
});

/* ============================================================
   SERVER START
   ============================================================ */

app.listen(PORT, () => {
  console.log(
    "✅ Verification Bot is LIVE and connected to CENTRAL DB on port",
    PORT
  );
});
