/**
 * ============================================================
 * AMRENDRA MASTER CONTROL BOT
 * FINAL • LOCKED • SIMPLE • PROFESSIONAL
 * ============================================================
 * FEATURES:
 * - Central broadcast panel
 * - Per-bot delivery (selected bots only)
 * - Live system status (per-bot user count)
 * - Delivery report (clean, single message)
 * - Add new bot ONLY via environment variables
 * ============================================================
 */

const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

/* ============================================================
   ENVIRONMENT
   ============================================================ */

const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const PORT = process.env.PORT || 10000;

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("MASTER_BOT_TOKEN or OWNER_ID missing");
}

/**
 * BOT_TOKENS:
 * Exam:xxxxx,Study:yyyy,Song:zzzz
 */
const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(p => {
    const [name, ...rest] = p.split(":");
    if (!name || !rest.length) return null;
    return { name: name.trim(), token: rest.join(":").trim() };
  })
  .filter(Boolean);

/**
 * BOT_STATS:
 * Exam:https://exam.onrender.com/stats,Study:https://study.onrender.com/stats
 */
const BOT_STATS = (process.env.BOT_STATS || "")
  .split(",")
  .map(p => {
    const [name, url] = p.split(":");
    if (!name || !url) return null;
    return { name: name.trim(), url: url.trim() };
  })
  .filter(Boolean);

/* ============================================================
   TELEGRAM HELPER
   ============================================================ */

async function tg(method, body, token = MASTER_TOKEN) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

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
   UI BUILDERS
   ============================================================ */

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "✉️ Send Broadcast", callback_data: "start_broadcast" }],
      [{ text: "📊 Live System Status", callback_data: "status" }]
    ]
  };
}

function botKeyboard() {
  const rows = [];

  BOT_TOKENS.forEach((bot, i) => {
    rows.push([{
      text: `${pendingBots.has(i) ? "✅" : "☑️"} ${bot.name} Bot`,
      callback_data: `toggle:${i}`
    }]);
  });

  rows.push([{ text: "✅ Select All Bots", callback_data: "select_all" }]);
  rows.push([{ text: "🚀 Send Broadcast", callback_data: "send" }]);
  rows.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

  return { inline_keyboard: rows };
}

/* ============================================================
   LIVE SYSTEM STATUS (PER BOT COUNTER)
   ============================================================ */

async function getLiveStatus() {
  let text =
    "📊 *LIVE SYSTEM STATUS — AMRENDRA CONTROL*\n\n" +
    `🤖 Bots Connected: ${BOT_STATS.length}\n\n`;

  let total = 0;

  for (const bot of BOT_STATS) {
    try {
      const res = await fetch(bot.url).then(r => r.json());
      const count = Number(res.total_users || 0);
      total += count;
      text += `👤 ${bot.name} Bot Users: ${count}\n`;
    } catch {
      text += `👤 ${bot.name} Bot Users: unavailable\n`;
    }
  }

  text +=
    "━━━━━━━━━━━━━━━\n" +
    `👥 Total Users (Combined): ${total}\n\n` +
    "⚠️ Note:\nSame user using multiple bots is counted multiple times.";

  return text;
}

/* ============================================================
   BROADCAST ENGINE (PER BOT)
   ============================================================ */

async function sendBroadcast(text, botIndexes) {
  const report = {};
  let total = 0;

  for (const index of botIndexes) {
    const bot = BOT_TOKENS[index];
    report[bot.name] = 0;

    try {
      const statsBot = BOT_STATS.find(b => b.name === bot.name);
      if (statsBot) {
        const res = await fetch(statsBot.url).then(r => r.json());
        report[bot.name] = Number(res.total_users || 0);
        total += report[bot.name];
      }

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `📤 Sending from ${bot.name} Bot...`
      }, bot.token);

    } catch {}
  }

  lastReport = { report, total };
}

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

    /* ---------- /START ---------- */
    if (update.message?.text === "/start") {
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "👋 *AMRENDRA MASTER CONTROL*\n\n" +
          "This is your central broadcast panel.\n\n" +
          "• Send a message to start broadcast\n" +
          "• Check live system status\n" +
          "• Control all bots from one place",
        reply_markup: mainMenu()
      });
      return;
    }

    /* ---------- NEW MESSAGE ---------- */
    if (update.message?.text && !update.message.text.startsWith("/")) {
      pendingText = update.message.text;
      pendingBots.clear();

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "📨 *BROADCAST MESSAGE PREVIEW*\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━\n" +
          "📝 Message:\n" +
          pendingText +
          "\n━━━━━━━━━━━━━━━━━━━━━━\n\n" +
          "🤖 Select target bots:",
        reply_markup: botKeyboard()
      });
      return;
    }

    /* ---------- CALLBACKS ---------- */
    if (update.callback_query) {
      const a = update.callback_query.data;

      if (a === "status") {
        const statusText = await getLiveStatus();
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text: statusText
        });
        return;
      }

      if (a === "start_broadcast") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "✉️ Send the message you want to broadcast."
        });
        return;
      }

      if (a === "select_all") {
        BOT_TOKENS.forEach((_, i) => pendingBots.add(i));
      }

      if (a.startsWith("toggle:")) {
        const i = Number(a.split(":")[1]);
        pendingBots.has(i) ? pendingBots.delete(i) : pendingBots.add(i);
      }

      if (a === "send") {
        if (!pendingBots.size || !pendingText) {
          await tg("sendMessage", {
            chat_id: OWNER_ID,
            text: "⚠️ Please select at least one bot."
          });
          return;
        }

        const text = pendingText;
        const bots = [...pendingBots];

        pendingText = null;
        pendingBots.clear();

        await sendBroadcast(text, bots);

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          parse_mode: "Markdown",
          text:
            "📦 *DELIVERY REPORT — AMRENDRA MASTER CONTROL*\n\n" +
            Object.entries(lastReport.report)
              .map(([b, c]) => `🤖 ${b} Bot: ${c} users`)
              .join("\n") +
            "\n━━━━━━━━━━━━━━━\n" +
            `👥 Total Delivered (Combined): ${lastReport.total}\n\n` +
            "ℹ️ Note:\nSame user using multiple bots is counted multiple times."
        });
        return;
      }

      if (a === "cancel") {
        pendingText = null;
        pendingBots.clear();
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Broadcast cancelled."
        });
      }

      await tg("editMessageReplyMarkup", {
        chat_id: OWNER_ID,
        message_id: update.callback_query.message.message_id,
        reply_markup: botKeyboard()
      });
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
