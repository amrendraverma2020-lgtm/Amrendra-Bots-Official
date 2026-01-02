/**
 * ============================================================
 * AMRENDRA BOT BUILDER / SUPPORT BOT
 * FINAL • REAL • EARNING READY • OWNER SAFE
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
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("BOT_TOKEN or OWNER_ID missing");
}

/* ================= FILES ================= */
const DATA_DIR = __dirname;
const USERS_FILE = path.join(DATA_DIR, "users.json");        // []
const WARNS_FILE = path.join(DATA_DIR, "warns.json");        // {}
const BLOCKS_FILE = path.join(DATA_DIR, "blocks.json");      // {}
const HISTORY_FILE = path.join(DATA_DIR, "block_history.json"); // []

/* ================= INIT FILES ================= */
function ensure(file, def) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
  }
}
ensure(USERS_FILE, []);
ensure(WARNS_FILE, {});
ensure(BLOCKS_FILE, {});
ensure(HISTORY_FILE, []);

/* ================= HELPERS ================= */
const now = () => Date.now();
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

/* ================= USER SAVE ================= */
function saveUser(id, username) {
  const users = read(USERS_FILE, []);
  if (!users.find(u => u.user_id === id)) {
    users.push({ user_id: id, username, joined_at: now() });
    write(USERS_FILE, users);
  }
}

/* ================= CLEANUP (AUTO) ================= */
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
  const history = read(HISTORY_FILE, []);
  const activeBlocks = {};
  for (const id in blocks) {
    if (blocks[id].until > now()) {
      activeBlocks[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });
      tg("sendMessage", { chat_id: id, text: "✅ You have been automatically unblocked." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `🔓 User ${id} auto-unblocked` });
    }
  }
  write(BLOCKS_FILE, activeBlocks);
  write(HISTORY_FILE, history.filter(h => h.expired_at > now() - 30*24*60*60*1000));
}

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");
  try {
    cleanup();

    const msg = req.body.message;
    if (!msg) return;

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

    /* ===== START ===== */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to *Amrendra Bot Builder*

🤖 This bot helps you create your own custom Telegram bot.

📌 How it works:
• Send your requirement in ONE message
• I will personally review it
• You will get a reply here itself

💰 Bot price starts from ₹150 only.

✉️ You can now send your message 👇`,
        parse_mode: "Markdown"
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (chatId === OWNER_ID && msg.text) {
      const parts = msg.text.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      /* SAFETY */
      if ((cmd === "/warn" || cmd === "/block" || cmd === "/block24") && target === OWNER_ID) {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Safety Lock: You cannot target yourself."
        });
        return;
      }

      /* /help */
      if (cmd === "/help") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
`📘 Commands List

/start - Welcome UI
/health - System diagnostic
/stats - Bot statistics

/warn <user_id> <reason>
/warnlist [user_id]

/block <user_id> <reason>
/block24 <user_id> <reason>
/blocklist
/unblock <user_id>

/reply <user_id> <message>
/send <user_id> (pricing message)
/paid <user_id>
/masterreply <message>`
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

📂 Users: ${users}
⚠️ Active Warns: ${warns}
🚫 Active Blocks: ${blocks}

🟢 Telegram API: CONNECTED
🟢 Data Persistence: OK`
        });
        return;
      }

      /* /stats */
      if (cmd === "/stats") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
`📊 BOT STATS

👤 Total Users: ${read(USERS_FILE, []).length}
⚠️ Warned Users: ${Object.keys(read(WARNS_FILE, {})).length}
🚫 Blocked Users: ${Object.keys(read(BLOCKS_FILE, {})).length}`
        });
        return;
      }

      /* /warn */
      if (cmd === "/warn") {
        if (!target) {
          await tg("sendMessage", {
            chat_id: OWNER_ID,
            text: "❌ Usage: /warn <user_id> <reason>"
          });
          return;
        }
        const reason = parts.slice(2).join(" ") || "No reason";
        const warns = read(WARNS_FILE, {});
        warns[target] = warns[target] || [];
        warns[target].push({ reason, expires: now()+30*24*60*60*1000 });
        write(WARNS_FILE, warns);

        await tg("sendMessage", {
          chat_id: target,
          text:
`⚠️ Warning Issued

Reason: ${reason}
3 warnings = auto block (48h)`
        });

        if (warns[target].length >= 3) {
          const blocks = read(BLOCKS_FILE, {});
          blocks[target] = {
            reason: "Auto-block (3 warnings)",
            duration: "48 hours",
            until: now()+48*60*60*1000
          };
          write(BLOCKS_FILE, blocks);
          await tg("sendMessage", {
            chat_id: target,
            text:
`⛔ Auto Blocked

Reason: 3 warnings
⏳ Duration: 48 hours`
          });
        }

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `⚠️ Warn added to ${target}`
        });
        return;
      }

      /* /warnlist */
      if (cmd === "/warnlist") {
        const id = target || OWNER_ID;
        const warns = read(WARNS_FILE, {});
        const list = warns[id] || [];
        let text = `⚠️ Warn List for ${id}\n\n`;
        text += list.length ? list.map((w,i)=>`${i+1}. ${w.reason}`).join("\n") : "No active warnings.";
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /block /block24 */
      if (cmd === "/block" || cmd === "/block24") {
        if (!target) {
          await tg("sendMessage", {
            chat_id: OWNER_ID,
            text: "❌ Usage: /block <user_id> <reason>"
          });
          return;
        }
        const reason = parts.slice(2).join(" ") || "No reason";
        const blocks = read(BLOCKS_FILE, {});
        blocks[target] = {
          reason,
          duration: cmd === "/block24" ? "24 hours" : "Permanent",
          until: cmd === "/block24" ? now()+24*60*60*1000 : now()+100*365*24*60*60*1000
        };
        write(BLOCKS_FILE, blocks);

        await tg("sendMessage", {
          chat_id: target,
          text:
`⛔ Access Denied

Reason: ${reason}
⏳ Duration: ${blocks[target].duration}`
        });

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `🚫 User ${target} blocked`
        });
        return;
      }

      /* /blocklist */
      if (cmd === "/blocklist") {
        const blocks = read(BLOCKS_FILE, {});
        let text = "🚫 Active Blocks\n\n";
        if (!Object.keys(blocks).length) text += "No active blocks.";
        for (const id in blocks) {
          const hrs = Math.ceil((blocks[id].until-now())/(1000*60*60));
          text += `• ${id} (${hrs}h left)\n`;
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /unblock */
      if (cmd === "/unblock") {
        if (!target) {
          await tg("sendMessage", {
            chat_id: OWNER_ID,
            text: "❌ Usage: /unblock <user_id>"
          });
          return;
        }
        const blocks = read(BLOCKS_FILE, {});
        delete blocks[target];
        write(BLOCKS_FILE, blocks);
        await tg("sendMessage", { chat_id: target, text: "✅ You have been unblocked." });
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ User ${target} unblocked` });
        return;
      }

      /* /reply */
      if (cmd === "/reply") {
        const replyText = parts.slice(2).join(" ");
        await tg("sendMessage", {
          chat_id: target,
          text: replyText
        });
        return;
      }

      /* /send (pricing) */
      if (cmd === "/send") {
        await tg("sendMessage", {
          chat_id: target,
          text:
`💰 Bot Development Charges — Amrendra Bot Builder

📦 Price: ₹150 only
💳 Payment in 3 steps:
₹50 start • ₹50 demo • ₹50 final

Reply YES to continue.`
        });
        return;
      }

      /* /paid */
      if (cmd === "/paid") {
        await tg("sendMessage", {
          chat_id: target,
          text:
`✅ Payment noted!

I will now start working on your bot.
You will receive updates soon.

— Amrendra`
        });
        return;
      }

      /* /masterreply */
      if (cmd === "/masterreply") {
        const text = parts.slice(1).join(" ");
        const users = read(USERS_FILE, []);
        let sent = 0;
        for (const u of users) {
          if (u.user_id === OWNER_ID) continue;
          if (read(BLOCKS_FILE, {})[u.user_id]) continue;
          await tg("sendMessage", {
            chat_id: u.user_id,
            text: `📢 Announcement\n\n${text}`
          });
          sent++;
        }
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `📢 Broadcast sent to ${sent} users.`
        });
        return;
      }
    }

    /* ================= USER → OWNER FORWARD ================= */
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      text:
`📩 New Message

👤 @${username}
🆔 ${userId}

💬 ${msg.text || "Non-text message"}`
    });

    await tg("sendMessage", {
      chat_id: chatId,
      text:
`✅ Message Received

Thanks for contacting me 🙏
I will reply soon.`
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("✅ Amrendra Bot Builder LIVE");
});
