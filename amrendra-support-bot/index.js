/**
 * ============================================================
 * AMRENDRA SUPPORT BOT
 * REAL • FINAL • PRODUCTION READY
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

/* ================= FILE PATHS ================= */
const USERS_FILE = path.join(__dirname, "users.json");            // []
const WARNS_FILE = path.join(__dirname, "warns.json");            // {}
const BLOCKS_FILE = path.join(__dirname, "blocks.json");          // {}
const HISTORY_FILE = path.join(__dirname, "block_history.json");  // []

/* ================= UTIL ================= */
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

/* ================= USER SAVE (PERMANENT) ================= */
function saveUser(id, username) {
  const users = read(USERS_FILE, []);
  if (!users.find(u => u.user_id === id)) {
    users.push({ user_id: id, username });
    write(USERS_FILE, users);
  }
}

/* ================= CLEANUP (RUN EVERY UPDATE) ================= */
function cleanup() {
  /* WARN EXPIRY */
  const warns = read(WARNS_FILE, {});
  let warnChanged = false;

  for (const id in warns) {
    const active = warns[id].filter(w => w.expires > now());
    if (active.length !== warns[id].length) {
      warnChanged = true;
      tg("sendMessage", { chat_id: id, text: "ℹ️ One of your warnings has expired." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `ℹ️ Warning expired for user ${id}` });
    }
    active.length ? warns[id] = active : delete warns[id];
  }
  if (warnChanged) write(WARNS_FILE, warns);

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
  write(
    HISTORY_FILE,
    history.filter(h => h.expired_at > now() - 30 * 24 * 60 * 60 * 1000)
  );
}

/* ================= SYSTEM HEALTH (REAL) ================= */
async function systemHealth() {
  const users = read(USERS_FILE, []);
  const warns = read(WARNS_FILE, {});
  const blocks = read(BLOCKS_FILE, {});

  const api = await tg("getMe", {});
  const apiStatus = api && api.ok ? "✅ CONNECTED" : "❌ FAILED";

  return `
🧠 SYSTEM DIAGNOSTIC

📂 users.json        ${Array.isArray(users) ? `✅ OK (${users.length} users)` : "❌ ERROR"}
📂 warns.json        ${typeof warns === "object" ? `⚠️ ${Object.keys(warns).length} users warned` : "❌ ERROR"}
📂 blocks.json       ${typeof blocks === "object" ? `✅ ${Object.keys(blocks).length} active blocks` : "❌ ERROR"}
📡 Telegram API      ${apiStatus}

🟢 STATUS: ${apiStatus.includes("CONNECTED") ? "STABLE" : "DEGRADED"}
`;
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

    /* BLOCK CHECK */
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

    /* START */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to Amrendra Support Bot

📌 How this works:
• Send your issue in ONE clear message
• Your message goes to the support team
• You will receive reply here itself

⚠️ Spamming may lead to temporary block.`
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (chatId === OWNER_ID && msg.text) {
      const parts = msg.text.trim().split(" ");
      const cmd = parts[0];
      const target = parts[1];

      if (target === OWNER_ID) {
        await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ You cannot target yourself." });
        return;
      }

      /* /health */
      if (cmd === "/health") {
        const report = await systemHealth();
        await tg("sendMessage", { chat_id: OWNER_ID, text: report });
        return;
      }

      /* /reply <userId> <msg> */
      if (cmd === "/reply") {
        const replyText = parts.slice(2).join(" ");
        await tg("sendMessage", {
          chat_id: target,
          text: `📩 Support Reply\n\n${replyText}`
        });
        return;
      }

      /* /masterreply <msg> */
      if (cmd === "/masterreply") {
        const text = parts.slice(1).join(" ");
        const users = read(USERS_FILE, []);
        let sent = 0;

        for (const u of users) {
          if (u.user_id === OWNER_ID) continue;
          if (blocks[u.user_id]) continue;
          await tg("sendMessage", {
            chat_id: u.user_id,
            text: `📢 Support Announcement\n\n${text}`
          });
          sent++;
        }

        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ Broadcast sent to ${sent} users.` });
        return;
      }

      /* /warn */
      if (cmd === "/warn") {
        const reason = parts.slice(2).join(" ") || "No reason";
        const warns = read(WARNS_FILE, {});
        warns[target] = warns[target] || [];
        warns[target].push({ reason, expires: now() + 30 * 24 * 60 * 60 * 1000 });
        write(WARNS_FILE, warns);

        await tg("sendMessage", {
          chat_id: target,
          text: `⚠️ Warning Issued\nReason: ${reason}\n3 warnings = 48h block`
        });

        if (warns[target].length >= 3) {
          const blocks = read(BLOCKS_FILE, {});
          blocks[target] = {
            reason: "Auto-block (3 warnings)",
            duration: "48 hours",
            until: now() + 48 * 60 * 60 * 1000
          };
          write(BLOCKS_FILE, blocks);
        }

        await tg("sendMessage", { chat_id: OWNER_ID, text: `⚠️ Warn added to ${target}` });
        return;
      }

      /* /warnlist */
      if (cmd === "/warnlist") {
        const warns = read(WARNS_FILE, {});
        const list = warns[target] || [];
        let text = `⚠️ Warn List for ${target}\n\n`;
        text += list.length ? list.map((w,i)=>`${i+1}. ${w.reason}`).join("\n") : "No active warnings.";
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /block /block24 */
      if (cmd === "/block" || cmd === "/block24") {
        const reason = parts.slice(2).join(" ") || "No reason";
        const blocks = read(BLOCKS_FILE, {});
        blocks[target] = {
          reason,
          duration: cmd === "/block24" ? "24 hours" : "Permanent",
          until: cmd === "/block24"
            ? now() + 24 * 60 * 60 * 1000
            : now() + 100 * 365 * 24 * 60 * 60 * 1000
        };
        write(BLOCKS_FILE, blocks);
        await tg("sendMessage", { chat_id: OWNER_ID, text: `🚫 User ${target} blocked` });
        return;
      }

      /* /blocklist */
      if (cmd === "/blocklist") {
        const blocks = read(BLOCKS_FILE, {});
        let text = "🚫 Active Blocks\n\n";
        for (const id in blocks) {
          const hrs = Math.ceil((blocks[id].until - now()) / (1000*60*60));
          text += `• ${id} (${hrs}h left)\n`;
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /unblock */
      if (cmd === "/unblock") {
        const blocks = read(BLOCKS_FILE, {});
        delete blocks[target];
        write(BLOCKS_FILE, blocks);
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ User ${target} unblocked` });
        await tg("sendMessage", { chat_id: target, text: "✅ You have been unblocked." });
        return;
      }
    }

    /* ================= NORMAL USER MESSAGE ================= */
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      text:
`📩 New Support Message

User: @${username}
ID: ${userId}

Message:
${msg.text || "Non-text message"}`
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
app.listen(PORT, () => {
  console.log("✅ Amrendra Support Bot running");
});
