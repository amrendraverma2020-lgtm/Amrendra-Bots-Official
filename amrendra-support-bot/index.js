/**
 * ============================================================
 * AMRENDRA SUPPORT BOT
 * FINAL • FULLY FUNCTIONAL • OWNER SAFE
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
const USERS_FILE = path.join(__dirname, "users.json");        // []
const WARNS_FILE = path.join(__dirname, "warns.json");        // {}
const BLOCKS_FILE = path.join(__dirname, "blocks.json");      // {}
const HISTORY_FILE = path.join(__dirname, "block_history.json"); // []

/* ================= HELPERS ================= */
const now = () => Date.now();

function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return def; }
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
function saveUser(userId, username) {
  const users = readJSON(USERS_FILE, []);
  if (!users.find(u => u.user_id === userId)) {
    users.push({ user_id: userId, username });
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
      tg("sendMessage", { chat_id: id, text: "ℹ️ A warning has expired." }).catch(()=>{});
      tg("sendMessage", { chat_id: OWNER_ID, text: `ℹ️ Warning expired for ${id}` }).catch(()=>{});
    }
    active.length ? warns[id] = active : delete warns[id];
  }

  if (changed) writeJSON(WARNS_FILE, warns);
}

/* ================= BLOCK CLEANUP ================= */
function cleanupBlocks() {
  const blocks = readJSON(BLOCKS_FILE, {});
  const history = readJSON(HISTORY_FILE, []);
  const active = {};
  const cutoff = now() - 30 * 24 * 60 * 60 * 1000;

  for (const id in blocks) {
    if (blocks[id].until > now()) {
      active[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });

      tg("sendMessage", {
        chat_id: id,
        text: "✅ You have been automatically unblocked."
      }).catch(()=>{});

      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `🔓 User ${id} auto-unblocked`
      }).catch(()=>{});
    }
  }

  writeJSON(BLOCKS_FILE, active);
  writeJSON(
    HISTORY_FILE,
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

    saveUser(userId, username);

    /* ================= BLOCK CHECK ================= */
    const blocks = readJSON(BLOCKS_FILE, {});
    if (blocks[userId]) {
      const b = blocks[userId];
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

Reason: ${b.reason}

⏳ Block Duration: ${b.duration}
You will be automatically unblocked after ${b.duration}.`
      });
      return;
    }

    /* ================= START ================= */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text:
`👋 *Welcome to Amrendra Support Bot*

Thank you for contacting us 🙏

📌 *How this works:*
• Send your issue in ONE clear message
• Your message goes directly to the support team
• You will receive reply here itself

⏳ *Response Time:*
Please wait patiently for a response

⚠️ Misuse or spam may lead to temporary block.`
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (chatId === OWNER_ID && msg.text?.startsWith("/")) {
      const parts = msg.text.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      if (target === OWNER_ID) {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Safety Lock: You cannot target yourself."
        });
        return;
      }

      /* /warn */
      if (cmd === "/warn") {
        const reason = parts.slice(2).join(" ") || "No reason";
        const warns = readJSON(WARNS_FILE, {});
        warns[target] = warns[target] || [];
        warns[target].push({
          reason,
          expires: now() + 30 * 24 * 60 * 60 * 1000
        });
        writeJSON(WARNS_FILE, warns);

        await tg("sendMessage", {
          chat_id: target,
          text:
`⚠️ Warning Issued

Reason: ${reason}

⚠️ 3 warnings = auto block (48 hours)`
        });

        if (warns[target].length >= 3) {
          const blocks = readJSON(BLOCKS_FILE, {});
          blocks[target] = {
            reason: "Auto-block due to 3 warnings",
            duration: "48 hours",
            until: now() + 48 * 60 * 60 * 1000
          };
          writeJSON(BLOCKS_FILE, blocks);

          await tg("sendMessage", {
            chat_id: target,
            text:
`⛔ Auto Blocked

Reason: 3 warnings received
⏳ Block Duration: 48 hours`
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
        const warns = readJSON(WARNS_FILE, {});
        const list = warns[id] || [];
        let text = `⚠️ Warn List for ${id}\n\n`;
        text += list.length
          ? list.map((w,i)=>`${i+1}. ${w.reason}`).join("\n")
          : "No active warnings.";
        await tg("sendMessage", { chat_id: chatId, text });
        return;
      }

      /* /block /block24 */
      if (cmd === "/block" || cmd === "/block24") {
        const reason = parts.slice(2).join(" ") || "No reason";
        const blocks = readJSON(BLOCKS_FILE, {});
        blocks[target] = {
          reason,
          duration: cmd === "/block24" ? "24 hours" : "Permanent",
          until:
            cmd === "/block24"
              ? now() + 24 * 60 * 60 * 1000
              : now() + 100 * 365 * 24 * 60 * 60 * 1000
        };
        writeJSON(BLOCKS_FILE, blocks);

        await tg("sendMessage", {
          chat_id: target,
          text:
`⛔ Access Denied

Reason: ${reason}

⏳ Block Duration: ${blocks[target].duration}`
        });

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `🚫 User ${target} blocked`
        });
        return;
      }

      /* /blocklist */
      if (cmd === "/blocklist") {
        const blocks = readJSON(BLOCKS_FILE, {});
        let text = "🚫 Active Blocks\n\n";
        if (!Object.keys(blocks).length) text += "No active blocks.";
        else {
          for (const id in blocks) {
            const hrs = Math.ceil((blocks[id].until - now()) / (1000*60*60));
            text += `• ${id} (${hrs}h left)\n`;
          }
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /unblock */
      if (cmd === "/unblock") {
        const blocks = readJSON(BLOCKS_FILE, {});
        delete blocks[target];
        writeJSON(BLOCKS_FILE, blocks);

        await tg("sendMessage", {
          chat_id: target,
          text: "✅ You have been unblocked."
        });

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `✅ User ${target} unblocked`
        });
        return;
      }
    }

    /* ================= FORWARD USER MESSAGE ================= */
    const blueId = `<a href="tg://user?id=${userId}">${userId}</a>`;
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "HTML",
      text:
`📩 New Support Message

👤 User: @${username}
🆔 User ID: ${blueId}

💬 Message:
${msg.text || "Non-text message"}`
    });

    await tg("sendMessage", {
      chat_id: chatId,
      text:
`✅ Message Received Successfully

Thank you for contacting Amrendra Support 🙏
Your message has been forwarded.
Please wait for a response.`
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("✅ Amrendra Support Bot LIVE");
});
