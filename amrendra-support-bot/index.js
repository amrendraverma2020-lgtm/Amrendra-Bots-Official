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
const BLOCK_HISTORY_FILE = path.join(__dirname, "block_history.json");

/* ================= UTIL ================= */
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const now = () => Date.now();

/* ================= TELEGRAM ================= */
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ================= USER SAVE ================= */
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
      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `⚠️ Warn expired for user ${id}`
      });
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

  for (const id in blocks) {
    if (blocks[id].until > now()) {
      updated[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });

      tg("sendMessage", {
        chat_id: id,
        text: "✅ You have been automatically unblocked."
      });

      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `🔓 User ${id} auto-unblocked`
      });
    }
  }

  const cutoff = now() - 30 * 24 * 60 * 60 * 1000;
  writeJSON(BLOCKS_FILE, updated);
  writeJSON(BLOCK_HISTORY_FILE, history.filter(h => h.expired_at > cutoff));
}

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");

  try {
    cleanupBlocks();
    cleanupWarns();

    const msg = req.body.message;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const username = msg.from.username || "N/A";

    saveUser({ user_id: userId, username });

    /* ===== BLOCK CHECK ===== */
    const blocks = readJSON(BLOCKS_FILE, {});
    if (blocks[userId]) {
      const hours = Math.ceil((blocks[userId].until - now()) / (1000 * 60 * 60));
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

You are blocked by the bot owner.
Reason: ${blocks[userId].reason}

⏳ Block Duration: ${hours} hours
You will be unblocked automatically.

Please wait patiently.`
      });
      return;
    }

    /* ===== OWNER COMMANDS ===== */
    if (chatId === OWNER_ID && msg.text) {
      const parts = msg.text.split("\n");
      const first = parts[0].trim();

      /* OWNER REPLY FORMAT */
      if (/^\d+$/.test(first)) {
        const reply = parts.slice(1).join("\n");
        await tg("sendMessage", {
          chat_id: first,
          text:
`📩 Support Team Reply

${reply}`
        });
        return;
      }

      const cmd = msg.text.split(" ")[0];

      /* WARN */
      if (cmd === "/warn") {
        const [, id, ...r] = msg.text.split(" ");
        const reason = r.join(" ") || "No reason";
        const warns = readJSON(WARNS_FILE, {});
        warns[id] = warns[id] || [];
        warns[id].push({ reason, expires: now() + 30 * 24 * 60 * 60 * 1000 });
        writeJSON(WARNS_FILE, warns);

        await tg("sendMessage", {
          chat_id: id,
          text:
`⚠️ Warning Issued

Reason: ${reason}
Please follow the rules to avoid further action.`
        });

        if (warns[id].length >= 3) {
          const blocks = readJSON(BLOCKS_FILE, {});
          blocks[id] = {
            user_id: id,
            reason: "Auto-block due to 3 warnings",
            until: now() + 48 * 60 * 60 * 1000
          };
          writeJSON(BLOCKS_FILE, blocks);

          await tg("sendMessage", {
            chat_id: id,
            text:
`⛔ Access Denied

You have been automatically blocked due to 3 warnings.

⏳ Block Duration: 48 hours`
          });
        }

        await tg("sendMessage", { chat_id: OWNER_ID, text: `⚠️ Warn added to ${id}` });
        return;
      }

      /* WARNLIST */
      if (cmd === "/warnlist") {
        const id = msg.text.split(" ")[1];
        const warns = readJSON(WARNS_FILE, {});
        const list = warns[id] || [];
        let text = `⚠️ Warn List for ${id}\n\n`;
        list.forEach((w, i) => text += `${i+1}. ${w.reason}\n`);
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* BLOCK / BLOCK24 */
      if (cmd === "/block" || cmd === "/block24") {
        const [, id, ...r] = msg.text.split(" ");
        const reason = r.join(" ") || "No reason";
        const until = cmd === "/block24"
          ? now() + 24 * 60 * 60 * 1000
          : now() + 100 * 365 * 24 * 60 * 60 * 1000;

        const blocks = readJSON(BLOCKS_FILE, {});
        blocks[id] = { user_id: id, reason, until };
        writeJSON(BLOCKS_FILE, blocks);

        await tg("sendMessage", {
          chat_id: id,
          text:
`⛔ Access Denied

You are blocked by the bot owner.
Reason: ${reason}

⏳ Block Duration: ${cmd === "/block24" ? "24 hours" : "Permanent"}`
        });

        await tg("sendMessage", { chat_id: OWNER_ID, text: `🚫 User ${id} blocked` });
        return;
      }

      /* UNBLOCK */
      if (cmd === "/unblock") {
        const id = msg.text.split(" ")[1];
        const blocks = readJSON(BLOCKS_FILE, {});
        delete blocks[id];
        writeJSON(BLOCKS_FILE, blocks);
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ User ${id} unblocked` });
        return;
      }
    }

    /* ===== USER MESSAGE → OWNER ===== */
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

Your message has been delivered.
You will be replied here itself.`
    });

  } catch (e) {
    console.error(e);
  }
});

/* ================= START ================= */
app.listen(PORT, () =>
  console.log("✅ Amrendra Support Bot running on port", PORT)
);
