/**
 * ============================================================
 * AMRENDRA VERIFICATION BOT
 * FINAL • MASTER SYNCED • BUTTON SAFE • RENDER READY
 * ============================================================
 */

const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

/* ============================================================
   ENVIRONMENT VARIABLES
   ============================================================ */

const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = process.env.FORCE_CHANNEL; // without @
const MASTER_API = process.env.MASTER_API; 
// example: https://amrendra-master-bot.onrender.com/register-user

const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL || !MASTER_API) {
  throw new Error("❌ BOT_TOKEN / FORCE_CHANNEL / MASTER_API missing");
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
      body: JSON.stringify(body)
    }
  );
  return res.json();
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
   SAVE USER INTO MASTER BOT
   ============================================================ */

async function registerWithMaster(user, payload) {
  try {
    const res = await fetch(MASTER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: user.id,
        username: user.username || "",
        name: user.first_name || "",
        bots: [payload]
      })
    });

    const data = await res.json();
    console.log("✅ REGISTERED WITH MASTER:", data);
  } catch (e) {
    console.error("❌ MASTER REGISTER ERROR:", e);
  }
}

/* ============================================================
   WEBHOOK HANDLER
   ============================================================ */

app.post("/", async (req, res) => {
  // 🔥 TELEGRAM REQUIREMENT
  res.send("ok");

  try {
    const msg = req.body.message;
    const cq = req.body.callback_query;

    /* ========================================================
       MESSAGE HANDLER (/start)
       ======================================================== */
    if (msg?.text) {
      const chatId = msg.chat.id;
      const user = msg.from;

      const payload = msg.text.split(" ")[1] || "default";
      const returnUrl = getReturnUrl(payload);

      /* ---------- NOT JOINED ---------- */
      if (!(await isJoined(user.id))) {
        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🔒 *Verification Required*\n\n" +
            "To continue, you must join our official channel.\n\n" +
            `📢 Channel: @${FORCE_CHANNEL}\n\n` +
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

      /* ---------- VERIFIED (SAVE TO MASTER) ---------- */
      await registerWithMaster(user, payload);

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
      await tg("answerCallbackQuery", {
        callback_query_id: cq.id
      });

      const chatId = cq.message.chat.id;
      const user = cq.from;

      if (cq.data.startsWith("recheck:")) {
        const payload = cq.data.split(":")[1] || "default";
        const returnUrl = getReturnUrl(payload);

        if (!(await isJoined(user.id))) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            show_alert: true,
            text: "❌ Please join the channel first."
          });
          return;
        }

        await registerWithMaster(user, payload);

        await tg("sendMessage", {
          chat_id: chatId,
          parse_mode: "Markdown",
          text:
            "🎉 *Verification Completed!*\n\n" +
            "Your account is now fully verified.\n\n" +
            "You may proceed safely.",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➡️ Continue to Bot", url: returnUrl }]
            ]
          }
        });
      }
    }
  } catch (err) {
    console.error("❌ VERIFICATION BOT ERROR:", err);
  }
});

/* ============================================================
   START SERVER
   ============================================================ */

app.listen(PORT, () => {
  console.log(
    "✅ VERIFICATION BOT LIVE | MASTER SYNC ENABLED | PORT:",
    PORT
  );
});
