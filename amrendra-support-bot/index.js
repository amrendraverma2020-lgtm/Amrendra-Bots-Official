/**
 * ============================================================
 * AMRENDRA SUPPORT BOT
 * FINAL • LOCKED • SAFE • OWNER-PROTECTED
 * ============================================================
 * FEATURES:
 * - Permanent user save (never deleted)
 * - Owner-only warn / block / unblock
 * - /warn (reason based)
 * - /warnlist (user + owner)
 * - Auto block after 3 warns (48h)
 * - /block & /block24 with reason
 * - /blocklist (active blocks)
 * - Block history (30 days, owner only)
 * - Auto unblock notify (user + owner)
 * - Clean UI (no duplicate messages)
 * - Owner can NEVER block himself
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

/* ================= FILE PATHS ================= */
const USERS_FILE = path.join(__dirname, "users.json");
const WARNS_FILE = path.join(__dirname, "warns.json");
const BLOCKS_FILE = path.join(__dirname, "blocks.json");
const BLOCK_HISTORY_FILE = path.join(__dirname, "block_history.json");

/* ================= UTIL ================= */
const now = () => Date.now();

function readJSON(file, def) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return def;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ================= TELEGRAM ================= */
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ================= USER SAVE (PERMANENT) ================= */
function saveUser(user) {
  const users = readJSON(USERS_FILE, []);
  if (!users.find(u => u.user_id === user.user_id)) {
    users.push(user);
    writeJSON(USERS_FILE, users);
  }
}

/* ================= WARN CLEANUP ================= */
function cleanupWarns() {
  const warns = readJSON(WARNS_FILE, {});
  let changed = false;

  for (const id in warns) {
    const active = warns[id].filter(w => w.expires > now());
    if (active.length !== warns[id].length) {
      changed = true;
      // notify expire
      tg("sendMessage", {
        chat_id: id,
        text: "ℹ️ One of your warnings has expired."
      }).catch(() => {});
      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `ℹ️ Warning expired for user ${id}`
      }).catch(() => {});
    }
    if (active.length) warns[id] = active;
    else delete warns[id];
  }

  if (changed) writeJSON(WARNS_FILE, warns);
}

/* ================= BLOCK CLEANUP ================= */
function cleanupBlocks() {
  const blocks = readJSON(BLOCKS_FILE, {});
  const history = readJSON(BLOCK_HISTORY_FILE, []);
  const updated = {};
  const cutoff = now() - 30 * 24 * 60 * 60 * 1000;

  for (const id in blocks) {
    if (blocks[id].until > now()) {
      updated[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });

      tg("sendMessage", {
        chat_id: id,
        text: "✅ You have been automatically unblocked."
      }).catch(() => {});

      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `🔓 User ${id} auto-unblocked`
      }).catch(() => {});
    }
  }

  writeJSON(BLOCKS_FILE, updated);
  writeJSON(
    BLOCK_HISTORY_FILE,
    history.filter(h => h.expired_at > cutoff)
  );
}

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");

  try {
    cleanupWarns();
    cleanupBlocks();

    const msg = req.body.message;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const username = msg.from.username || "N/A";

    saveUser({ user_id: userId, username });

    /* ===== BLOCK CHECK ===== */
    const blocks = readJSON(BLOCKS_FILE, {});
    if (blocks[userId]) {
      const b = blocks[userId];
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

You are blocked by the bot owner.
Reason: ${b.reason}

⏳ Block Duration: ${b.duration}
You will be automatically unblocked after ${b.duration}.`
      });
      return;
    }

    /* ===== /START ===== */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text:
`👋 *Welcome to Amrendra Support Bot*

Thank you for contacting us 🙏

📌 *How this works:*
• Simply send your message here
• Your message will be forwarded to the support team
• Explain your issue clearly in one message

⏳ *Response Time:*
Our team will reply as soon as possible.

⚠️ *Note:*
Spamming may lead to temporary block.

✉️ You can now send your message below 👇`
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (chatId === OWNER_ID && msg.text) {
      const parts = msg.text.split(" ");
      const cmd = parts[0];

      /* SAFETY: OWNER NEVER BLOCKS SELF */
      if (parts[1] === OWNER_ID) {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Safety Lock: You cannot block or warn yourself."
        });
        return;
      }

      /* /warn */
      if (cmd === "/warn") {
        const id = parts[1];
        const reason = parts.slice(2).join(" ") || "No reason";

        const warns = readJSON(WARNS_FILE, {});
        warns[id] = warns[id] || [];
        warns[id].push({
          reason,
          expires: now() + 30 * 24 * 60 * 60 * 1000
        });
        writeJSON(WARNS_FILE, warns);

        await tg("sendMessage", {
          chat_id: id,
          text:
`⚠️ Warning Issued

Reason: ${reason}

⚠️ Repeated warnings may lead to auto-block.`
        });

        if (warns[id].length >= 3) {
          const blocks = readJSON(BLOCKS_FILE, {});
          blocks[id] = {
            user_id: id,
            reason: "Auto-block: 3 warnings",
            duration: "48 hours",
            until: now() + 48 * 60 * 60 * 1000
          };
          writeJSON(BLOCKS_FILE, blocks);

          await tg("sendMessage", {
            chat_id: id,
            text:
`⛔ You have been automatically blocked

⚠️ Reason:
You received 3 warnings.

⏳ Block Duration: 48 hours`
          });
        }

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `⚠️ Warn added to ${id}`
        });
        return;
      }

      /* /warnlist */
      if (cmd === "/warnlist") {
        const id = parts[1] || OWNER_ID;
        const warns = readJSON(WARNS_FILE, {});
        const list = warns[id] || [];

        let text = `⚠️ Warn List for ${id}\n\n`;
        if (!list.length) text += "No active warnings.";
        else {
          list.forEach((w, i) => {
            text += `${i + 1}. ${w.reason}\n`;
          });
        }

        await tg("sendMessage", { chat_id: chatId, text });
        return;
      }

      /* /block & /block24 */
      if (cmd === "/block" || cmd === "/block24") {
        const id = parts[1];
        const reason = parts.slice(2).join(" ") || "No reason";
        const duration = cmd === "/block24" ? "24 hours" : "Permanent";

        const blocks = readJSON(BLOCKS_FILE, {});
        blocks[id] = {
          user_id: id,
          reason,
          duration,
          until:
            cmd === "/block24"
              ? now() + 24 * 60 * 60 * 1000
              : now() + 100 * 365 * 24 * 60 * 60 * 1000
        };
        writeJSON(BLOCKS_FILE, blocks);

        await tg("sendMessage", {
          chat_id: id,
          text:
`⛔ Access Denied

Reason: ${reason}

⏳ Block Duration: ${duration}`
        });

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `🚫 User ${id} blocked`
        });
        return;
      }

      /* /unblock */
      if (cmd === "/unblock") {
        const id = parts[1];
        const blocks = readJSON(BLOCKS_FILE, {});
        delete blocks[id];
        writeJSON(BLOCKS_FILE, blocks);

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `✅ User ${id} unblocked`
        });
        return;
      }
    }

    /* ================= FORWARD USER MESSAGE ================= */
    let content = "💬 Message:\n";
    if (msg.text) content += msg.text;
    else if (msg.photo) content += "📷 Photo received";
    else if (msg.document) content += "📎 Document received";
    else if (msg.video) content += "🎥 Video received";
    else content += "📩 New message";

    const blueId = `<a href="tg://user?id=${userId}">${userId}</a>`;

    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "HTML",
      text:
`📩 New Support Message

👤 User: @${username}
🆔 User ID: ${blueId}

${content}`
    });

    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "Markdown",
      text:
`✅ *Message Received Successfully*

Thank you for contacting Amrendra Support 🙏

📨 Your message has been delivered to our team.
⏳ Please wait for a response.`
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("✅ Amrendra Support Bot running on port", PORT);
});
