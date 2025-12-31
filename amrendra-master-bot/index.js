const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ================= ENV =================
const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const PORT = process.env.PORT || 10000;

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "20", 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "3000", 10);

// name:token,name:token
const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(p => {
    const [name, token] = p.split(":");
    return name && token ? { name, token } : null;
  })
  .filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("Missing MASTER_BOT_TOKEN or OWNER_ID");
}

// ================= CENTRAL DB =================
const DB_FILE = path.join(__dirname, "../central-db/users.json");

// auto-create DB
if (!fs.existsSync(DB_FILE)) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
}

let DB = JSON.parse(fs.readFileSync(DB_FILE));

const saveDB = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));

// ================= HELPERS =================
async function tg(method, body, token = MASTER_TOKEN) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ================= SECURITY =================
function ownerOnly(update) {
  const uid =
    update?.message?.from?.id ||
    update?.callback_query?.from?.id;
  return String(uid) === OWNER_ID;
}

// ================= STATE =================
let pendingText = null;
let pendingBots = new Set();
let emergencyStop = false;

// ================= USER FILTER =================
function getEligibleUsers(botIndexes = []) {
  return Object.values(DB.users).filter(u => {
    if (!u.verified || u.blocked) return false;
    if ((u.warnings || 0) >= 3) return false;

    if (botIndexes.length === 0) return true;
    return botIndexes.some(i => u.bots?.includes(BOT_TOKENS[i]?.name));
  });
}

// ================= UI =================
function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "📊 System Status", callback_data: "status" }],
      [{ text: "🛑 Emergency Stop", callback_data: "stop" }]
    ]
  };
}

function botButtons() {
  const rows = BOT_TOKENS.map((b, i) => [{
    text: `${pendingBots.has(i) ? "✅" : "☑️"} ${b.name}`,
    callback_data: `toggle:${i}`
  }]);

  rows.push([{ text: "✅ Select All Bots", callback_data: "select_all" }]);
  rows.push([
    { text: "🚀 Send", callback_data: "send" },
    { text: "❌ Cancel", callback_data: "cancel" }
  ]);

  return { inline_keyboard: rows };
}

// ================= BROADCAST =================
async function sendNow(text, users) {
  for (const bot of BOT_TOKENS) {
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      if (emergencyStop) return;

      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(u =>
          tg("sendMessage",
            { chat_id: u.id, text, parse_mode: "Markdown" },
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
  if (users.length === 0) return 0;

  await sendNow(text, users);
  DB.stats = DB.stats || { broadcasts_sent: 0 };
  DB.stats.broadcasts_sent++;
  saveDB();
  return users.length;
}

// ================= SYSTEM STATUS =================
function getSystemStatus() {
  const users = Object.values(DB.users);
  return (
    "📊 *Live System Status*\n\n" +
    `👥 Total users: ${users.length}\n` +
    `✅ Verified: ${users.filter(u => u.verified).length}\n` +
    `🚫 Blocked: ${users.filter(u => u.blocked).length}\n` +
    `⚠️ Warned: ${users.filter(u => (u.warnings || 0) > 0).length}\n\n` +
    `🤖 Bots: ${BOT_TOKENS.length}\n`
  );
}

// ================= WEBHOOK =================
app.post("/", async (req, res) => {
  res.send("ok"); // 🔥 MUST
  try {
    const u = req.body;
    if (!ownerOnly(u)) return;

    if (u.message?.text === "/start") {
      return tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "👋 *Master Bot Ready*",
        parse_mode: "Markdown",
        reply_markup: mainMenu()
      });
    }

    if (u.message?.text && !u.message.text.startsWith("/")) {
      pendingText = u.message.text;
      pendingBots.clear();
      return tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `📨 *Preview*\n\n${pendingText}`,
        parse_mode: "Markdown",
        reply_markup: botButtons()
      });
    }

    if (u.callback_query) {
      const d = u.callback_query.data;

      if (d === "status") {
        return tg("sendMessage", {
          chat_id: OWNER_ID,
          text: getSystemStatus(),
          parse_mode: "Markdown"
        });
      }

      if (d === "select_all") {
        pendingBots = new Set(BOT_TOKENS.map((_, i) => i));
      }

      if (d.startsWith("toggle:")) {
        const i = +d.split(":")[1];
        pendingBots.has(i) ? pendingBots.delete(i) : pendingBots.add(i);
      }

      if (d === "send") {
        const count = await broadcast(pendingText, [...pendingBots]);
        pendingText = null;
        pendingBots.clear();

        return tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
            count === 0
              ? "⚠️ No verified users yet"
              : `✅ Sent to ${count} users`,
          parse_mode: "Markdown"
        });
      }
    }
  } catch (e) {
    console.error(e);
  }
});

app.listen(PORT, () =>
  console.log("✅ Master Bot running on", PORT)
);
