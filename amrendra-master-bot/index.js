/**
 * ============================================================
 * AMRENDRA MASTER CONTROL BOT
 * FINAL • STABLE • BUTTON-SAFE • RENDER READY
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

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 20);
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS || 3000);

/**
 * BOT_TOKENS format (Render ENV):
 * BOT_TOKENS=Exam:xxxx,Study:yyyy,Song:zzzz
 */
const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(p => {
    const parts = p.split(":");
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
   CENTRAL DATABASE (CRASH SAFE)
   ============================================================ */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

if (!fs.existsSync(DB_FILE)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ users: {}, queue: [], stats: {} }, null, 2)
  );
}

let DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

// 🔒 SAFETY INIT
DB.users = DB.users || {};
DB.queue = DB.queue || [];
DB.stats = DB.stats || {};
DB.stats.broadcasts_sent = DB.stats.broadcasts_sent || 0;

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ============================================================
   TELEGRAM API HELPER
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
   SECURITY (OWNER ONLY)
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
let emergencyStop = false;

/* ============================================================
   USER FILTER
   ============================================================ */

function getEligibleUsers(botIndexes = []) {
  return Object.values(DB.users).filter(u => {
    if (!u.verified) return false;
    if (u.blocked) return false;
    if ((u.warnings || 0) >= 3) return false;

    if (botIndexes.length === 0) return true;

    return botIndexes.some(i =>
      u.bots?.includes(BOT_TOKENS[i]?.name)
    );
  });
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
    rows.push([{
      text: `${pendingBots.has(i) ? "✅" : "☑️"} ${bot.name.toUpperCase()} BOT`,
      callback_data: `toggle:${i}`
    }]);
  });

  rows.push([{ text: "✅ SELECT ALL BOTS", callback_data: "select_all" }]);

  rows.push([
    { text: "🚀 SEND BROADCAST", callback_data: "send" },
    { text: "❌ CANCEL", callback_data: "cancel" }
  ]);

  rows.push([{ text: "🛑 EMERGENCY STOP", callback_data: "stop" }]);

  return { inline_keyboard: rows };
}

/* ============================================================
   BROADCAST ENGINE (FAIL SAFE)
   ============================================================ */

async function sendNow(text, users) {
  for (const bot of BOT_TOKENS) {
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      if (emergencyStop) return;

      const batch = users.slice(i, i + BATCH_SIZE);

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
}

async function processQueue() {
  while (DB.queue.length && !emergencyStop) {
    const job = DB.queue.shift();
    saveDB();
    await sendNow(job.text, job.users);
  }
}

async function broadcast(text, botIndexes) {
  const users = getEligibleUsers(botIndexes);
  if (!users.length) return 0;

  DB.queue.push({ text, users });
  saveDB();

  await processQueue();

  DB.stats.broadcasts_sent++;
  saveDB();

  return users.length;
}

/* ============================================================
   SYSTEM STATUS
   ============================================================ */

function getSystemStatus() {
  DB.stats = DB.stats || {};
  DB.stats.broadcasts_sent = DB.stats.broadcasts_sent || 0;

  const users = Object.values(DB.users);

  return (
    "📊 *LIVE SYSTEM STATUS*\n\n" +
    `👥 Total Users: ${users.length}\n` +
    `✅ Verified: ${users.filter(u => u.verified).length}\n` +
    `🚫 Blocked: ${users.filter(u => u.blocked).length}\n` +
    `⚠️ Warned: ${users.filter(u => (u.warnings || 0) > 0).length}\n\n` +
    `🤖 Bots Connected: ${BOT_TOKENS.length}\n` +
    `📨 Broadcasts Sent: ${DB.stats.broadcasts_sent}`
  );
}

/* ============================================================
   API: REGISTER USER FROM VERIFICATION BOT
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
   WEBHOOK (BUTTON SAFE)
   ============================================================ */

app.post("/", async (req, res) => {
  res.send("ok"); // 🔥 MUST

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
          "Central command system is **ONLINE**.\n\n" +
          "• Bot-wise broadcast\n" +
          "• Live system monitoring\n" +
          "• Emergency controls\n\n" +
          "_All systems operational._",
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
          "📨 *Broadcast Preview*\n\n" +
          pendingText +
          "\n\nSelect target bots:",
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
      }

      if (a.startsWith("toggle:")) {
        const i = Number(a.split(":")[1]);
        pendingBots.has(i) ? pendingBots.delete(i) : pendingBots.add(i);
      }

      await tg("editMessageReplyMarkup", {
        chat_id: OWNER_ID,
        message_id: update.callback_query.message.message_id,
        reply_markup: botKeyboard()
      });

      if (a === "send") {
        const count = await broadcast(pendingText, [...pendingBots]);
        pendingText = null;
        pendingBots.clear();

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text:
            count === 0
              ? "⚠️ No eligible users found."
              : `✅ Broadcast delivered to *${count} users*.`
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

      if (a === "stop") {
        emergencyStop = true;
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "🛑 Emergency stop activated."
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
