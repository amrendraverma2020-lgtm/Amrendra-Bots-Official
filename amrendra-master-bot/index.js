const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");

const app = express();
app.use(express.json());

// ================= ENV =================
const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const PORT = process.env.PORT || 10000;

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "20", 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "3000", 10);

// 21 bot tokens (empty ignored)
const BOT_TOKENS = Array.from({ length: 21 }, (_, i) =>
  process.env[`BOT_${i + 1}_TOKEN`]
).filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("Missing MASTER_BOT_TOKEN or OWNER_ID");
}

// ================= DB =================
const DB_FILE = "./db.json";
let DB = JSON.parse(fs.readFileSync(DB_FILE));

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= SECURITY =================
function ownerOnly(update) {
  const uid =
    update?.message?.from?.id ||
    update?.callback_query?.from?.id;
  return String(uid) === OWNER_ID;
}

// ================= STATE =================
let pendingMessage = null;
let pendingBots = [];
let emergencyStop = false;
let lastReport = null;

// ================= MESSAGE TEMPLATES =================
const TEMPLATES = {
  exam_postponed:
    "📢 *Official Exam Notification*\n\nThe examination has been postponed.\nPlease stay alert for further updates.",
  admit_card:
    "📄 *Admit Card Update*\n\nAdmit cards are now available.\nDownload from the official portal."
};

// ================= USER FILTERS =================
function getEligibleUsers(selectedBots = []) {
  return Object.values(DB.users).filter((u) => {
    if (!u.verified) return false;
    if (u.blocked) return false;
    if (u.warnings >= 3) return false;

    if (selectedBots.length === 0) return true;
    if (!Array.isArray(u.bots)) return false;

    return selectedBots.some((b) => u.bots.includes(b));
  });
}

// ================= FAIL-SAFE QUEUE =================
async function processQueue() {
  while (DB.queue.length > 0 && !emergencyStop) {
    const item = DB.queue.shift();
    await sendMessage(item.text, item.targets);
    saveDB();
  }
}

async function sendMessage(text, users) {
  let sent = 0;
  let failed = 0;

  for (const token of BOT_TOKENS) {
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      if (emergencyStop) break;

      const batch = users.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map((u) =>
          tg("sendMessage", { chat_id: u.id, text }, token)
            .then(() => true)
            .catch(() => false)
        )
      );

      sent += results.filter(Boolean).length;
      failed += results.filter((r) => !r).length;

      await sleep(BATCH_DELAY_MS);
    }
  }

  return { sent, failed };
}

// ================= BROADCAST ENGINE =================
async function broadcast(text, selectedBots = []) {
  const users = getEligibleUsers(selectedBots);

  DB.queue.push({ text, targets: users });
  saveDB();

  const result = await processQueue();

  DB.stats.broadcasts_sent += 1;
  DB.stats.active_today = users.length;
  saveDB();

  return {
    botsUsed: selectedBots.length || "ALL",
    usersTargeted: users.length,
    sent: result?.sent || 0,
    failed: result?.failed || 0
  };
}

// ================= ROUTES =================
app.get("/", (_, res) => {
  res.send("Amrendra Master Bot – FULL SYSTEM ACTIVE");
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
          "• Global broadcast engine\n" +
          "• Bot-wise targeting\n" +
          "• Fail-safe queue\n" +
          "• Global block & warning sync\n\n" +
          "Send a message or template key to begin.",
        parse_mode: "Markdown"
      });
      return res.send("ok");
    }

    // TEMPLATE OR TEXT
    if (u.message?.text && !u.message.text.startsWith("/")) {
      pendingMessage = TEMPLATES[u.message.text] || u.message.text;
      pendingBots = [];

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "📨 *Broadcast Ready*\n\n" +
          `"${pendingMessage}"\n\n` +
          "Use:\n/confirm\n/cancel\n/stop",
        parse_mode: "Markdown"
      });
      return res.send("ok");
    }

    // CONFIRM
    if (u.message?.text === "/confirm" && pendingMessage) {
      lastReport = await broadcast(pendingMessage, pendingBots);

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "✅ *Message Sent Successfully*\n\n" +
          "📥 Delivery Report\n" +
          `Users targeted: ${lastReport.usersTargeted}\n` +
          `Sent: ${lastReport.sent}\n` +
          `Failed: ${lastReport.failed}`,
        parse_mode: "Markdown"
      });

      pendingMessage = null;
      pendingBots = [];
      return res.send("ok");
    }

    // CANCEL
    if (u.message?.text === "/cancel") {
      pendingMessage = null;
      pendingBots = [];
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "❌ Broadcast cancelled."
      });
      return res.send("ok");
    }

    // STOP
    if (u.message?.text === "/stop") {
      emergencyStop = true;
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "🛑 Emergency stop activated."
      });
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
  console.log("Amrendra Master Bot – FULL SYSTEM RUNNING on port", PORT);
});
