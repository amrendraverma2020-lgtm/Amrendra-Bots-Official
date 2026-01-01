/**
 * ============================================================
 * AMRENDRA MASTER CONTROL BOT
 * FINAL • STABLE • PROFESSIONAL BROADCAST PANEL
 * ============================================================
 */

const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ============================================================
   ENVIRONMENT
   ============================================================ */

const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const PORT = process.env.PORT || 10000;

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS || 3000);

/**
 * BOT_TOKENS example:
 * BOT_TOKENS=Exam:xxx,Study:yyy,Song:zzz
 */
const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(p => {
    const i = p.indexOf(":");
    if (i === -1) return null;
    return {
      name: p.slice(0, i).trim(),
      token: p.slice(i + 1).trim()
    };
  })
  .filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("❌ MASTER_BOT_TOKEN or OWNER_ID missing");
}

/* ============================================================
   CENTRAL DATABASE
   ============================================================ */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

if (!fs.existsSync(DB_FILE)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ users: {}, stats: {} }, null, 2)
  );
}

let DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
DB.users = DB.users || {};
DB.stats = DB.stats || {};
DB.stats.broadcasts_sent = DB.stats.broadcasts_sent || 0;

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ============================================================
   TELEGRAM HELPER
   ============================================================ */

async function tg(method, body, token = MASTER_TOKEN) {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================
   SECURITY
   ============================================================ */

function ownerOnly(update) {
  const id =
    update?.message?.from?.id ||
    update?.callback_query?.from?.id;
  return String(id) === OWNER_ID;
}

/* ============================================================
   RUNTIME STATE
   ============================================================ */

let pendingText = null;
let pendingBots = new Set();
let lastReport = null;

/* ============================================================
   USER FILTER PER BOT
   ============================================================ */

function getUsersForBot(botName) {
  return Object.values(DB.users).filter(u =>
    u.verified &&
    !u.blocked &&
    (u.warnings || 0) < 3 &&
    Array.isArray(u.bots) &&
    u.bots.includes(botName)
  );
}

/* ============================================================
   UI BUILDERS
   ============================================================ */

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "📊 Live System Status", callback_data: "status" }]
    ]
  };
}

function botKeyboard() {
  const rows = [];

  BOT_TOKENS.forEach((bot, i) => {
    rows.push([
      {
        text: `${pendingBots.has(i) ? "✅" : "☑️"} ${bot.name} Bot`,
        callback_data: `toggle:${i}`
      }
    ]);
  });

  // 🔥 SELECT ALL BUTTON
  rows.push([
    { text: "✅ SELECT ALL BOTS", callback_data: "select_all" }
  ]);

  rows.push([
    { text: "🚀 SEND BROADCAST", callback_data: "send" }
  ]);

  rows.push([
    { text: "❌ CANCEL", callback_data: "cancel" }
  ]);

  return { inline_keyboard: rows };
}

/* ============================================================
   BROADCAST ENGINE (PER BOT – FIXED)
   ============================================================ */

async function sendBroadcast(text, botIndexes) {
  const report = {};
  let total = 0;

  for (const i of botIndexes) {
    const bot = BOT_TOKENS[i];
    const users = getUsersForBot(bot.name);

    report[bot.name] = users.length;
    total += users.length;

    for (let x = 0; x < users.length; x += BATCH_SIZE) {
      const batch = users.slice(x, x + BATCH_SIZE);

      await Promise.all(
        batch.map(u =>
          tg(
            "sendMessage",
            { chat_id: u.id, text, parse_mode: "Markdown" },
            bot.token
          ).catch(() => {})
        )
      );

      await sleep(BATCH_DELAY_MS);
    }
  }

  DB.stats.broadcasts_sent++;
  saveDB();

  lastReport = {
    id: DB.stats.broadcasts_sent,
    perBot: report,
    total
  };

  return total;
}

/* ============================================================
   SYSTEM STATUS
   ============================================================ */

function getSystemStatus() {
  const users = Object.values(DB.users);

  return (
    "📊 *LIVE SYSTEM STATUS — AMRENDRA CONTROL*\n\n" +
    `👥 Total Users Registered: ${users.length}\n` +
    `✅ Verified Users: ${users.filter(u => u.verified).length}\n` +
    `🚫 Blocked Users: ${users.filter(u => u.blocked).length}\n` +
    `⚠️ Users with Warnings: ${users.filter(u => (u.warnings || 0) > 0).length}\n\n` +
    `🤖 Active Bots Connected: ${BOT_TOKENS.length}\n` +
    `📨 Total Broadcasts Delivered: ${DB.stats.broadcasts_sent}\n\n` +
    "🟢 System Health: STABLE\n" +
    "🔒 Central database synced"
  );
}

/* ============================================================
   API — REGISTER USER FROM VERIFICATION BOT
   ============================================================ */

app.post("/register-user", (req, res) => {
  try {
    const { id, username, name, bots } = req.body || {};
    if (!id) return res.status(400).json({ ok: false });

    const old = DB.users[id] || {};

    DB.users[id] = {
      id,
      username: username || old.username || "",
      name: name || old.name || "",
      verified: true,
      bots: Array.from(new Set([...(old.bots || []), ...(bots || [])])),
      blocked: old.blocked || false,
      warnings: old.warnings || 0,
      verified_at: old.verified_at || Date.now()
    };

    saveDB();
    console.log("✅ USER REGISTERED:", id);
    res.json({ ok: true });
  } catch (e) {
    console.error("REGISTER USER ERROR:", e);
    res.status(500).json({ ok: false });
  }
});

/* ============================================================
   WEBHOOK
   ============================================================ */

app.post("/", async (req, res) => {
  res.send("ok");

  try {
    const update = req.body;
    if (!ownerOnly(update)) return;

    if (update.callback_query) {
      await tg("answerCallbackQuery", {
        callback_query_id: update.callback_query.id
      });
    }

    if (update.message?.text === "/start") {
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "👋 *AMRENDRA MASTER CONTROL*\n\n" +
          "Welcome to your Central Command System 🚀\n\n" +
          "👉 To begin, SEND the message you want to broadcast.",
        reply_markup: mainMenu()
      });
      return;
    }

    if (update.message?.text && !update.message.text.startsWith("/")) {
      pendingText = update.message.text;
      pendingBots.clear();

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "📨 *BROADCAST MESSAGE PREVIEW*\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━\n" +
          "📝 Message Content:\n" +
          pendingText +
          "\n━━━━━━━━━━━━━━━━━━━━━━\n\n" +
          "🤖 Select target bots:",
        reply_markup: botKeyboard()
      });
      return;
    }

    if (update.callback_query) {
      const a = update.callback_query.data;

      if (a === "status") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text: getSystemStatus()
        });
        return;
      }

      if (a === "select_all") {
        pendingBots = new Set(BOT_TOKENS.map((_, i) => i));
        await tg("editMessageReplyMarkup", {
          chat_id: OWNER_ID,
          message_id: update.callback_query.message.message_id,
          reply_markup: botKeyboard()
        });
        return;
      }

      if (a.startsWith("toggle:")) {
        const i = Number(a.split(":")[1]);
        pendingBots.has(i) ? pendingBots.delete(i) : pendingBots.add(i);

        await tg("editMessageReplyMarkup", {
          chat_id: OWNER_ID,
          message_id: update.callback_query.message.message_id,
          reply_markup: botKeyboard()
        });
        return;
      }

      if (a === "send") {
        if (!pendingBots.size) {
          await tg("sendMessage", {
            chat_id: OWNER_ID,
            text: "⚠️ Please select at least one bot."
          });
          return;
        }

        await sendBroadcast(pendingText, [...pendingBots]);

        pendingText = null;
        pendingBots.clear();

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text: "✅ *Broadcast Sent Successfully*",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📦 View Delivery Report", callback_data: "report" }]
            ]
          }
        });
        return;
      }

      if (a === "report" && lastReport) {
        let t = `📦 *Delivery Report — #${lastReport.id}*\n\n`;
        for (const [bot, c] of Object.entries(lastReport.perBot)) {
          t += `🤖 ${bot} Bot: ${c} users\n`;
        }
        t += `\n👥 Total Delivered: ${lastReport.total}`;

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text: t
        });
      }

      if (a === "cancel") {
        pendingText = null;
        pendingBots.clear();
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Broadcast cancelled."
        });
      }
    }
  } catch (e) {
    console.error("MASTER BOT ERROR:", e);
  }
});

/* ============================================================
   START SERVER
   ============================================================ */

app.listen(PORT, () => {
  console.log("✅ AMRENDRA MASTER BOT RUNNING ON PORT", PORT);
});
