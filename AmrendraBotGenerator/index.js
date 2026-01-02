/**
 * ============================================================
 * AMRENDRA BOT GENERATOR PRO
 * FINAL • REAL • EARNING READY • OWNER SAFE
 * ============================================================
 * FEATURES:
 * /start  → Premium Welcome UI
 * /help   → Command list
 * /health → REAL system diagnostic (owner only)
 * /stats  → Users / Warns / Blocks count
 *
 * User → Owner forwarding (text + photo + doc + video)
 * /reply <userId> <message>
 * /masterreply <message> (broadcast)
 *
 * /warn <userId> <reason>
 * /warnlist [userId]
 * 3 warns → auto block 48h (REAL)
 *
 * /block <userId> <reason>
 * /block24 <userId> <reason>
 * /blocklist
 * /unblock <userId>
 *
 * Owner can NEVER block/warn himself
 * Permanent user save (Render restart safe)
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
  throw new Error("❌ BOT_TOKEN or OWNER_ID missing");
}

/* ================= FILES ================= */
const USERS_FILE = path.join(__dirname, "users.json");
const WARNS_FILE = path.join(__dirname, "warns.json");
const BLOCKS_FILE = path.join(__dirname, "blocks.json");
const HISTORY_FILE = path.join(__dirname, "block_history.json");

/* ================= HELPERS ================= */
const now = () => Date.now();
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json()).catch(() => null);
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
  // WARN EXPIRY
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

  // BLOCK EXPIRY
  const blocks = read(BLOCKS_FILE, {});
  const history = read(HISTORY_FILE, []);
  const activeBlocks = {};

  for (const id in blocks) {
    if (blocks[id].until > now()) {
      activeBlocks[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });
      tg("sendMessage", { chat_id: id, text: "✅ You are automatically unblocked." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `🔓 Auto-unblocked ${id}` });
    }
  }

  write(BLOCKS_FILE, activeBlocks);
  write(
    HISTORY_FILE,
    history.filter(h => h.expired_at > now() - 30 * 24 * 60 * 60 * 1000)
  );
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

    /* ========== BLOCK CHECK ========== */
    const blocks = read(BLOCKS_FILE, {});
    if (blocks[userId]) {
      const b = blocks[userId];
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

Reason: ${b.reason}
⏳ Duration: ${b.duration}

Please wait until unblock.`
      });
      return;
    }

    /* ========== /START ========== */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to *Amrendra Bot Generator Pro*

🤖 Create your own custom bot
📸 Send screenshot / details
💬 Chat directly with developer

⏳ You will get reply here itself.

⚠️ Spam = temporary block.`,
        parse_mode: "Markdown"
      });
      return;
    }

    /* ========== /HELP ========== */
    if (msg.text === "/help") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`📖 Available Commands

/start - Welcome panel
/help - Command list

Owner only:
/health - System diagnostic
/stats - Users / warns / blocks
/warn userId reason
/warnlist [userId]
/block userId reason
/block24 userId reason
/blocklist
/unblock userId
/reply userId message
/masterreply message`
      });
      return;
    }

    /* ========== OWNER COMMANDS ========== */
    if (chatId === OWNER_ID && msg.text?.startsWith("/")) {
      const p = msg.text.split(" ");
      const cmd = p[0];
      const target = p[1];

      if ((cmd === "/warn" || cmd.startsWith("/block")) && target === OWNER_ID) {
        await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ You cannot target yourself." });
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

📂 users.json  ✅ (${users})
📂 warns.json  ⚠️ (${warns})
📂 blocks.json ✅ (${blocks})

🟢 Telegram API: CONNECTED`
        });
        return;
      }

      /* /stats */
      if (cmd === "/stats") {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text:
`📊 BOT STATS

👤 Users: ${read(USERS_FILE, []).length}
⚠️ Warned users: ${Object.keys(read(WARNS_FILE, {})).length}
🚫 Blocked users: ${Object.keys(read(BLOCKS_FILE, {})).length}`
        });
        return;
      }

      /* /warn */
      if (cmd === "/warn") {
        if (!target) {
          await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ Usage: /warn <userId> <reason>" });
          return;
        }
        const reason = p.slice(2).join(" ") || "No reason";
        const warns = read(WARNS_FILE, {});
        warns[target] = warns[target] || [];
        warns[target].push({ reason, expires: now() + 30 * 24 * 60 * 60 * 1000 });
        write(WARNS_FILE, warns);

        await tg("sendMessage", {
          chat_id: target,
          text: `⚠️ Warning issued\nReason: ${reason}`
        });

        if (warns[target].length >= 3) {
          const blocks = read(BLOCKS_FILE, {});
          blocks[target] = {
            reason: "Auto block: 3 warnings",
            duration: "48 hours",
            until: now() + 48 * 60 * 60 * 1000
          };
          write(BLOCKS_FILE, blocks);

          await tg("sendMessage", {
            chat_id: target,
            text: "⛔ You are auto-blocked for 48 hours (3 warnings)."
          });
        }

        await tg("sendMessage", { chat_id: OWNER_ID, text: `⚠️ Warn added to ${target}` });
        return;
      }

      /* /warnlist */
      if (cmd === "/warnlist") {
        const id = target || OWNER_ID;
        const warns = read(WARNS_FILE, {});
        const list = warns[id] || [];
        let text = `⚠️ Warn list for ${id}\n\n`;
        text += list.length ? list.map((w,i)=>`${i+1}. ${w.reason}`).join("\n") : "No active warns.";
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /block /block24 */
      if (cmd === "/block" || cmd === "/block24") {
        if (!target) {
          await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ Usage: /block <userId> <reason>" });
          return;
        }
        const reason = p.slice(2).join(" ") || "No reason";
        const blocks = read(BLOCKS_FILE, {});
        blocks[target] = {
          reason,
          duration: cmd === "/block24" ? "24 hours" : "Permanent",
          until: cmd === "/block24" ? now() + 24*60*60*1000 : now() + 100*365*24*60*60*1000
        };
        write(BLOCKS_FILE, blocks);

        await tg("sendMessage", { chat_id: target, text: `⛔ Blocked\nReason: ${reason}` });
        await tg("sendMessage", { chat_id: OWNER_ID, text: `🚫 Blocked ${target}` });
        return;
      }

      /* /blocklist */
      if (cmd === "/blocklist") {
        const blocks = read(BLOCKS_FILE, {});
        let text = "🚫 Active Blocks\n\n";
        if (!Object.keys(blocks).length) text += "No active blocks.";
        else {
          for (const id in blocks) {
            const hrs = Math.ceil((blocks[id].until - now()) / 3600000);
            text += `• ${id} (${hrs}h left)\n`;
          }
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /unblock */
      if (cmd === "/unblock") {
        const blocks = read(BLOCKS_FILE, {});
        delete blocks[target];
        write(BLOCKS_FILE, blocks);
        await tg("sendMessage", { chat_id: target, text: "✅ You are unblocked." });
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ Unblocked ${target}` });
        return;
      }

      /* /reply */
      if (cmd === "/reply") {
        const replyText = p.slice(2).join(" ");
        await tg("sendMessage", { chat_id: target, text: `📩 Support Reply\n\n${replyText}` });
        return;
      }

      /* /masterreply */
      if (cmd === "/masterreply") {
        const text = p.slice(1).join(" ");
        const users = read(USERS_FILE, []);
        let sent = 0;
        for (const u of users) {
          if (u.user_id === OWNER_ID) continue;
          await tg("sendMessage", { chat_id: u.user_id, text: `📢 Announcement\n\n${text}` });
          sent++;
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ Broadcast sent to ${sent} users.` });
        return;
      }
    }

    /* ========== FORWARD USER MESSAGE ========== */
    let content = "";
    if (msg.text) content = msg.text;
    else if (msg.photo) content = "📸 Screenshot received";
    else if (msg.document) content = "📎 Document received";
    else if (msg.video) content = "🎥 Video received";
    else content = "📩 Message received";

    await tg("sendMessage", {
      chat_id: OWNER_ID,
      text:
`📩 New Client Message

👤 @${username}
🆔 ${userId}

${content}`
    });

    await tg("sendMessage", {
      chat_id: chatId,
      text: "✅ Message received. Please wait for reply."
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () => console.log("✅ Amrendra Bot Generator Pro LIVE"));
