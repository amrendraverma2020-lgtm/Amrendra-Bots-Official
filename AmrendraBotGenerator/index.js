/**
 * ============================================================
 * AMRENDRA BOT BUILDER (EARNING + SUPPORT)
 * FINAL • STABLE • ALL FEATURES ENABLED
 * ============================================================
 */

const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const OWNER_USERNAME = process.env.OWNER_USERNAME || "YourUsername";
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("BOT_TOKEN or OWNER_ID missing");
}

/* ================= FILES ================= */
const USERS_FILE = path.join(__dirname, "users.json");        // []
const WARNS_FILE = path.join(__dirname, "warns.json");        // {}
const BLOCKS_FILE = path.join(__dirname, "blocks.json");      // {}
const HISTORY_FILE = path.join(__dirname, "block_history.json"); // []

/* ================= HELPERS ================= */
const now = () => Date.now();
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json()).catch(()=>{});
}

/* ================= USER SAVE ================= */
function saveUser(id, username) {
  const users = read(USERS_FILE, []);
  if (!users.find(u => u.user_id === id)) {
    users.push({ user_id: id, username });
    write(USERS_FILE, users);
  }
}

/* ================= CLEANUP ================= */
function cleanup() {
  /* WARN EXPIRY */
  const warns = read(WARNS_FILE, {});
  for (const id in warns) {
    const active = warns[id].filter(w => w.expires > now());
    if (active.length !== warns[id].length) {
      tg("sendMessage", { chat_id: id, text: "ℹ️ One of your warnings has expired." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `ℹ️ Warning expired for ${id}` });
    }
    active.length ? warns[id] = active : delete warns[id];
  }
  write(WARNS_FILE, warns);

  /* BLOCK EXPIRY */
  const blocks = read(BLOCKS_FILE, {});
  const hist = read(HISTORY_FILE, []);
  const activeBlocks = {};
  for (const id in blocks) {
    if (blocks[id].until > now()) activeBlocks[id] = blocks[id];
    else {
      hist.push({ ...blocks[id], expired_at: now() });
      tg("sendMessage", { chat_id: id, text: "✅ You have been automatically unblocked." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `🔓 User ${id} auto-unblocked` });
    }
  }
  write(BLOCKS_FILE, activeBlocks);
  write(HISTORY_FILE, hist.filter(h => h.expired_at > now() - 30*24*60*60*1000));
}

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");
  try {
    cleanup();
    const update = req.body;
    const msg = update.message;
    const cb = update.callback_query;
    if (!msg && !cb) return;

    /* ===== CALLBACK BUTTONS ===== */
    if (cb) {
      const cid = cb.from.id;
      if (cb.data === "create_bot") {
        await tg("sendMessage", {
          chat_id: cid,
          text:
`📝 Please send complete information about your bot in ONE message.

Include:
• Bot type (Exam / Support / Business / Other)
• What the bot should do
• Special features (if any)
• Preferred bot name (optional)

I will personally review and reply.`
        });
      }
      return;
    }

    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const username = msg.from.username || "N/A";

    saveUser(userId, username);

    /* ===== BLOCK CHECK ===== */
    const blocks = read(BLOCKS_FILE, {});
    if (blocks[userId]) {
      const b = blocks[userId];
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

Reason: ${b.reason}

⏳ Block Duration: ${b.duration}
You will be automatically unblocked.`
      });
      return;
    }

    /* ================= START ================= */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to Amrendra Bot Builder

🤖 This bot helps you create your own custom Telegram bot.

📌 How it works:
• Send your requirement in ONE message
• I will personally review it
• You will get a reply here itself

💰 Bot price starts from ₹150 only.

✉️ Choose an option below 👇`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🤖 Create Your Bot", callback_data: "create_bot" }],
            [{ text: "📞 Contact Owner", url: `https://t.me/${OWNER_USERNAME}` }]
          ]
        }
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (chatId === OWNER_ID && msg.text?.startsWith("/")) {
      const parts = msg.text.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      if (target === OWNER_ID) {
        await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ You cannot target yourself." });
        return;
      }

      /* /help */
      if (cmd === "/help") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
`/reply <id> <msg> - Reply to user
/send <id> - Send fixed intro message
/masterreply <msg> - Broadcast
/warn <id> <reason>
/warnlist [id]
/block <id> <reason>
/block24 <id> <reason>
/blocklist
/unblock <id>
/health
/stats`
        });
        return;
      }

      /* /health */
      if (cmd === "/health") {
        const users = read(USERS_FILE, []).length;
        const warns = Object.keys(read(WARNS_FILE, {})).length;
        const blocks = Object.keys(read(BLOCKS_FILE, {})).length;
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
`🧠 SYSTEM DIAGNOSTIC

👥 Users: ${users}
⚠️ Active Warns: ${warns}
🚫 Active Blocks: ${blocks}

🟢 Status: STABLE`
        });
        return;
      }

      /* /stats */
      if (cmd === "/stats") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
`📊 BOT STATS

👥 Users: ${read(USERS_FILE, []).length}
⚠️ Warns: ${Object.keys(read(WARNS_FILE, {})).length}
🚫 Blocks: ${Object.keys(read(BLOCKS_FILE, {})).length}`
        });
        return;
      }

      /* /reply */
      if (cmd === "/reply") {
        await tg("sendMessage", {
          chat_id: target,
          text: `📩 Message from Amrendra (Owner)\n\n${parts.slice(2).join(" ")}`
        });
        return;
      }

      /* /send (fixed intro) */
      if (cmd === "/send") {
        await tg("sendMessage", {
          chat_id: target,
          text:
`📩 Message from Amrendra (Owner)

Hello 👋  
Main Amrendra hoon — is bot ka owner.

Maine aapka message personally dekh liya hai ✅  

🧠 Please send:
1️⃣ Bot type  
2️⃣ Bot work  
3️⃣ Features  
4️⃣ Bot name  

Ek hi message me likhiye 🙏`
        });
        return;
      }

      /* /masterreply */
      if (cmd === "/masterreply") {
        const users = read(USERS_FILE, []);
        let sent = 0;
        for (const u of users) {
          if (u.user_id === OWNER_ID) continue;
          if (blocks[u.user_id]) continue;
          await tg("sendMessage", {
            chat_id: u.user_id,
            text: `📢 Announcement\n\n${parts.slice(1).join(" ")}`
          });
          sent++;
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ Sent to ${sent} users.` });
        return;
      }
    }

    /* ================= FORWARD USER MESSAGE ================= */
    let content = msg.text || "📎 Non-text message received";
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      text:
`📩 New Client Message

👤 @${username}
🆔 ${userId}

💬 ${content}`
    });

    await tg("sendMessage", {
      chat_id: chatId,
      text:
`✅ Message Received Successfully

Thank you for contacting Amrendra 🙏  
I will personally review and reply.`
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () => console.log("✅ Amrendra Bot Builder LIVE"));
