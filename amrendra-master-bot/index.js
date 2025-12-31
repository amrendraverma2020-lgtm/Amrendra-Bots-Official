/**
 * ============================================================
 * AMRENDRA MASTER CONTROL BOT
 * ------------------------------------------------------------
 * This bot acts as the CENTRAL COMMAND SYSTEM for all bots.
 *
 * Core Responsibilities:
 * - Central broadcast engine
 * - Bot-wise user targeting
 * - Global block & warning respect
 * - Central DB reader
 * - System status reporting
 * - Rate-limited, safe message delivery
 *
 * NOTE:
 * - This file is intentionally written VERBOSE & LONG
 * - For clarity, stability & future maintenance
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

const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const PORT = process.env.PORT || 10000;

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "20", 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "3000", 10);

/**
 * BOT_TOKENS format (Render ENV):
 * BOT_TOKENS=Exam:xxxxx,Study:yyyy,Song:zzzzz
 */
const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(pair => {
    const parts = pair.split(":");
    if (parts.length < 2) return null;
    return {
      name: parts[0].trim(),
      token: parts.slice(1).join(":").trim()
    };
  })
  .filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("❌ MASTER_BOT_TOKEN or OWNER_ID missing");
}

/* ============================================================
   CENTRAL DATABASE (SHARED WITH VERIFICATION BOT)
   ============================================================ */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

if (!fs.existsSync(DB_FILE)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, stats: {} }, null, 2));
}

let DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ============================================================
   TELEGRAM API HELPER
   ============================================================ */

async function tg(method, body, token = MASTER_TOKEN) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  return response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   SECURITY: OWNER ONLY
   ============================================================ */

function ownerOnly(update) {
  const userId =
    update?.message?.from?.id ||
    update?.callback_query?.from?.id;

  return String(userId) === OWNER_ID;
}

/* ============================================================
   RUNTIME STATE
   ============================================================ */

let pendingText = null;
let pendingBots = new Set();
let emergencyStop = false;

/* ============================================================
   USER FILTERING LOGIC
   ============================================================ */

function getEligibleUsers(selectedBotIndexes = []) {
  return Object.values(DB.users || {}).filter(user => {
    if (!user.verified) return false;
    if (user.blocked) return false;
    if ((user.warnings || 0) >= 3) return false;

    if (selectedBotIndexes.length === 0) {
      return true;
    }

    return selectedBotIndexes.some(index =>
      user.bots?.includes(BOT_TOKENS[index]?.name)
    );
  });
}

/* ============================================================
   USER INTERFACE (INLINE BUTTONS)
   ============================================================ */

function mainMenu() {
  return {
    inline_keyboard: [
      [
        {
          text: "📊 View Live System Status",
          callback_data: "status"
        }
      ]
    ]
  };
}

function botSelectionKeyboard() {
  const keyboard = [];

  BOT_TOKENS.forEach((bot, index) => {
    const isSelected = pendingBots.has(index);

    keyboard.push([
      {
        text: `${isSelected ? "✅ SELECTED" : "☑️ SELECT"} — ${bot.name.toUpperCase()} BOT`,
        callback_data: `toggle:${index}`
      }
    ]);
  });

  keyboard.push([
    {
      text: "✅ SELECT ALL BOTS",
      callback_data: "select_all"
    }
  ]);

  keyboard.push([
    {
      text: "🚀 SEND BROADCAST NOW",
      callback_data: "send"
    },
    {
      text: "❌ CANCEL BROADCAST",
      callback_data: "cancel"
    }
  ]);

  keyboard.push([
    {
      text: "🛑 EMERGENCY STOP SYSTEM",
      callback_data: "stop"
    }
  ]);

  return { inline_keyboard: keyboard };
}

/* ============================================================
   BROADCAST ENGINE
   ============================================================ */

async function sendNow(text, users) {
  for (const bot of BOT_TOKENS) {
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      if (emergencyStop) return;

      const batch = users.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(user =>
          tg(
            "sendMessage",
            {
              chat_id: user.id,
              text: text,
              parse_mode: "Markdown"
            },
            bot.token
          ).catch(() => {})
        )
      );

      await sleep(BATCH_DELAY_MS);
    }
  }
}

async function broadcast(text, botIndexes) {
  const users = getEligibleUsers(botIndexes);

  if (users.length === 0) {
    return 0;
  }

  await sendNow(text, users);

  DB.stats.broadcasts_sent =
    (DB.stats.broadcasts_sent || 0) + 1;

  saveDB();
  return users.length;
}

/* ============================================================
   SYSTEM STATUS MESSAGE
   ============================================================ */

function getSystemStatus() {
  const users = Object.values(DB.users || {});

  return (
    "📊 *AMRENDRA BOT ECOSYSTEM — LIVE STATUS*\n\n" +
    `👥 Total Users Registered: ${users.length}\n` +
    `✅ Verified Users: ${users.filter(u => u.verified).length}\n` +
    `🚫 Blocked Users: ${users.filter(u => u.blocked).length}\n` +
    `⚠️ Warned Users: ${users.filter(u => (u.warnings || 0) > 0).length}\n\n` +
    `🤖 Connected Bots: ${BOT_TOKENS.length}\n` +
    `📨 Broadcasts Sent: ${DB.stats.broadcasts_sent || 0}\n\n` +
    "_System operating normally._"
  );
}

/* ============================================================
   WEBHOOK HANDLER
   ============================================================ */

app.post("/", async (req, res) => {
  res.send("ok"); // IMPORTANT

  try {
    const update = req.body;
    if (!ownerOnly(update)) return;

    /* ---------------- START ---------------- */
    if (update.message?.text === "/start") {
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "👋 *WELCOME TO AMRENDRA MASTER CONTROL SYSTEM*\n\n" +
          "This is the **central command hub** of your entire bot ecosystem.\n\n" +
          "From here you can:\n" +
          "• Broadcast messages safely\n" +
          "• Target users bot-wise\n" +
          "• Monitor live system status\n" +
          "• Control emergency shutdown\n\n" +
          "_System is online and ready._",
        reply_markup: mainMenu()
      });
      return;
    }

    /* ---------------- NEW MESSAGE ---------------- */
    if (update.message?.text && !update.message.text.startsWith("/")) {
      pendingText = update.message.text;
      pendingBots.clear();

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "📨 *BROADCAST MESSAGE PREVIEW*\n\n" +
          `${pendingText}\n\n` +
          "👇 Select target bots carefully:",
        reply_markup: botSelectionKeyboard()
      });
      return;
    }

    /* ---------------- CALLBACKS ---------------- */
    if (update.callback_query) {
      const action = update.callback_query.data;

      if (action === "status") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text: getSystemStatus()
        });
        return;
      }

      if (action === "select_all") {
        pendingBots = new Set(BOT_TOKENS.map((_, i) => i));
      }

      if (action.startsWith("toggle:")) {
        const index = Number(action.split(":")[1]);
        pendingBots.has(index)
          ? pendingBots.delete(index)
          : pendingBots.add(index);
      }

      if (action === "send") {
        const count = await broadcast(pendingText, [...pendingBots]);
        pendingText = null;
        pendingBots.clear();

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text:
            count === 0
              ? "⚠️ *No eligible users found.*\n\nEnsure users are verified."
              : `✅ *Broadcast Successful*\n\nMessage delivered to **${count} users**.`
        });
        return;
      }

      if (action === "cancel") {
        pendingText = null;
        pendingBots.clear();

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Broadcast cancelled safely."
        });
        return;
      }

      if (action === "stop") {
        emergencyStop = true;
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "🛑 EMERGENCY STOP ACTIVATED.\n\nAll broadcasts halted."
        });
      }
    }
  } catch (err) {
    console.error("❌ Master Bot Error:", err);
  }
});

/* ============================================================
   SERVER START
   ============================================================ */

app.listen(PORT, () => {
  console.log("✅ AMRENDRA MASTER BOT RUNNING ON PORT", PORT);
});
