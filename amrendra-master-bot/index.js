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

// 🔥 Unlimited bots with names (name:token)
const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(pair => {
    const [name, token] = pair.split(":");
    return name && token ? { name, token } : null;
  })
  .filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("Missing MASTER_BOT_TOKEN or OWNER_ID");
}

// ================= CENTRAL DB =================
const DB_FILE = path.join(__dirname, "../central-db/users.json");

let DB = {
  users: {},   // userId -> user object
  queue: [],
  stats: {
    broadcasts_sent: 0
  }
};

if (fs.existsSync(DB_FILE)) {
  try {
    DB = JSON.parse(fs.readFileSync(DB_FILE));
  } catch {}
}

const saveDB = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));

// ================= HELPERS =================
async function tg(method, body, token = MASTER_TOKEN) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// ================= TEMPLATES =================
const TEMPLATES = {
  exam_postponed:
    "📢 *Official Exam Notification*\n\nThe examination has been postponed.\nPlease stay alert for further updates.",
  admit_card:
    "📄 *Admit Card Update*\n\nAdmit cards are now available.\nDownload from the official portal."
};

// ================= USER FILTER =================
function getEligibleUsers(selectedBotIndexes = []) {
  return Object.values(DB.users).filter(u => {
    if (!u.verified) return false;
    if (u.blocked) return false;
    if ((u.warnings || 0) >= 3) return false;

    if (selectedBotIndexes.length === 0) return true;
    if (!Array.isArray(u.bots)) return false;

    return selectedBotIndexes.some(i =>
      u.bots.includes(BOT_TOKENS[i]?.name)
    );
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
  const rows = [];

  BOT_TOKENS.forEach((bot, i) => {
    const checked = pendingBots.has(i) ? "✅" : "☑️";
    rows.push([
      {
        text: `${checked} ${bot.name.toUpperCase()}`,
        callback_data: `toggle:${i}`
      }
    ]);
  });

  rows.push([{ text: "✅ Select All Bots", callback_data: "select_all" }]);

  rows.push([
    { text: "🚀 Send Message", callback_data: "send" },
    { text: "❌ Cancel", callback_data: "cancel" }
  ]);

  return { inline_keyboard: rows };
}

// ================= FAIL-SAFE QUEUE =================
async function processQueue() {
  while (DB.queue.length > 0 && !emergencyStop) {
    const job = DB.queue.shift();
    await sendNow(job.text, job.targets);
    saveDB();
  }
}

async function sendNow(text, users) {
  for (const bot of BOT_TOKENS) {
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      if (emergencyStop) break;

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

// ================= BROADCAST =================
async function broadcast(text, botIndexes = []) {
  const users = getEligibleUsers(botIndexes);

  DB.queue.push({ text, targets: users });
  saveDB();

  await processQueue();

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
    `🤖 Bots connected: ${BOT_TOKENS.length}\n` +
    `📨 Broadcasts sent: ${DB.stats.broadcasts_sent}`
  );
}

// ================= ROUTES =================
app.get("/", (_, res) => {
  res.send("Amrendra Master Bot — FINAL SYSTEM RUNNING");
});

app.post("/", async (req, res) => {
  try {
    const u = req.body;
    if (!ownerOnly(u)) return res.send("ok");

    // START
    if (u.message?.text === "/start") {
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "👋 *Welcome Amrendra*\n\n" +
          "This is your MASTER CONTROL BOT.\n\n" +
          "• Bot-wise broadcast\n" +
          "• Fail-safe queue\n" +
          "• Rate-limited sending\n" +
          "• Global block & warning sync\n\n" +
          "Send a message or template key to begin.",
        parse_mode: "Markdown",
        reply_markup: mainMenu()
      });
      return res.send("ok");
    }

    // TEXT / TEMPLATE
    if (u.message?.text && !u.message.text.startsWith("/")) {
      pendingText = TEMPLATES[u.message.text] || u.message.text;
      pendingBots.clear();

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "📨 *Broadcast Preview*\n\n" +
          `"${pendingText}"\n\n` +
          "Select target bots below 👇",
        parse_mode: "Markdown",
        reply_markup: botButtons()
      });
      return res.send("ok");
    }

    // CALLBACKS
    if (u.callback_query) {
      const d = u.callback_query.data;

      if (d === "status") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: getSystemStatus(),
          parse_mode: "Markdown"
        });
      }

      else if (d === "select_all") {
        pendingBots.clear();
        BOT_TOKENS.forEach((_, i) => pendingBots.add(i));
      }

      else if (d.startsWith("toggle:")) {
        const id = parseInt(d.split(":")[1], 10);
        pendingBots.has(id)
          ? pendingBots.delete(id)
          : pendingBots.add(id);
      }

      else if (d === "send" && pendingText) {
        const count = await broadcast(pendingText, [...pendingBots]);

        let msg =
          "✅ *Broadcast Processed*\n\n";

        if (count === 0) {
          msg +=
            "⚠️ No users received this message.\n\n" +
            "Reason:\n" +
            "• No verified users in database\n" +
            "• Child bots have not registered users yet\n\n" +
            "💡 Once users verify via other bots,\n" +
            "broadcasts will auto-start.";
        } else {
          msg += `📥 Users targeted: ${count}`;
        }

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: msg,
          parse_mode: "Markdown"
        });

        pendingText = null;
        pendingBots.clear();
      }

      else if (d === "cancel") {
        pendingText = null;
        pendingBots.clear();
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Broadcast cancelled."
        });
      }

      else if (d === "stop") {
        emergencyStop = true;
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "🛑 Emergency stop activated."
        });
      }

      await tg("answerCallbackQuery", {
        callback_query_id: u.callback_query.id
      });

      if (pendingText) {
        await tg("editMessageReplyMarkup", {
          chat_id: OWNER_ID,
          message_id: u.callback_query.message.message_id,
          reply_markup: botButtons()
        });
      }

      return res.send("ok");
    }

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Amrendra Master Bot — FINAL SYSTEM ACTIVE on port", PORT);
});
