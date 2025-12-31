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

// 21 bot tokens (empty ignored safely)
const BOT_TOKENS = Array.from({ length: 21 }, (_, i) =>
  process.env[`BOT_${i + 1}_TOKEN`]
).filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("Missing MASTER_BOT_TOKEN or OWNER_ID");
}

// ================= DB =================
const DB_FILE = "./db.json";
let DB = JSON.parse(fs.readFileSync(DB_FILE));

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

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
let emergencyStop = false;
let lastReport = null;

// ================= CORE LOGIC =================

// Central registry read (safe)
function getEligibleUsers() {
  return Object.values(DB.users).filter(
    (u) => u.verified === true && u.blocked !== true
  );
}

// Broadcast engine (real but DB-driven)
async function broadcast(text) {
  const users = getEligibleUsers();

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

  emergencyStop = false;

  DB.stats.broadcasts_sent += 1;
  saveDB();

  return {
    usersTargeted: users.length,
    sent,
    failed,
  };
}

// ================= ROUTES =================
app.get("/", (_, res) => {
  res.send("Amrendra Master Bot – Phase 1 running");
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
          "👋 Welcome Amrendra\n\n" +
          "This is the MASTER CONTROL BOT.\n\n" +
          "• Central broadcast engine\n" +
          "• Global block system (ready)\n" +
          "• Analytics base (ready)\n\n" +
          "Send a message to begin broadcast.",
      });
      return res.send("ok");
    }

    // NEW MESSAGE
    if (u.message?.text) {
      pendingMessage = u.message.text;

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "📨 Broadcast Message Ready:\n\n" +
          `"${pendingMessage}"\n\n` +
          "Send /confirm to broadcast\n" +
          "Send /cancel to abort",
      });
      return res.send("ok");
    }

    // CONFIRM
    if (u.message?.text === "/confirm" && pendingMessage) {
      lastReport = await broadcast(pendingMessage);

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "✅ Message sent successfully.\n\n" +
          "📥 Delivery Report\n" +
          `Users targeted: ${lastReport.usersTargeted}\n` +
          `Sent: ${lastReport.sent}\n` +
          `Failed: ${lastReport.failed}`,
      });

      pendingMessage = null;
      return res.send("ok");
    }

    // CANCEL
    if (u.message?.text === "/cancel") {
      pendingMessage = null;
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "❌ Broadcast cancelled.",
      });
      return res.send("ok");
    }

    // EMERGENCY STOP
    if (u.message?.text === "/stop") {
      emergencyStop = true;
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "🛑 Emergency stop activated.",
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
  console.log("Amrendra Master Bot – Phase 1 running on port", PORT);
});
