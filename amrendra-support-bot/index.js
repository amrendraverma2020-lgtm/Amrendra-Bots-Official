const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const SUPPORT_BOT_LINK = process.env.SUPPORT_BOT_LINK;
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
const readJSON = (f, d) => {
  try { return JSON.parse(fs.readFileSync(f)); }
  catch { return d; }
};
const writeJSON = (f, d) =>
  fs.writeFileSync(f, JSON.stringify(d, null, 2));

const now = () => Date.now();

/* ================= INIT FILES ================= */
[USERS_FILE, WARNS_FILE, BLOCKS_FILE, BLOCK_HISTORY_FILE].forEach(f => {
  if (!fs.existsSync(f)) writeJSON(f, f.includes("users") ? [] : {});
});

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

/* ================= WARN CLEANUP + NOTIFY ================= */
function cleanupWarns() {
  const warns = readJSON(WARNS_FILE, {});
  for (const id in warns) {
    const active = warns[id].filter(w => w.expires > now());
    if (active.length !== warns[id].length) {
      tg("sendMessage", {
        chat_id: id,
        text: "ℹ️ One of your warnings has expired."
      });
      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `ℹ️ Warning expired for user ${id}`
      });
    }
    if (active.length) warns[id] = active;
    else delete warns[id];
  }
  writeJSON(WARNS_FILE, warns);
}

/* ================= BLOCK CLEANUP + NOTIFY ================= */
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
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

You are blocked by the bot owner.
Reason: ${blocks[userId].reason}

⏳ You will be unblocked automatically.

If you believe this is a mistake, contact the owner.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "📞 Contact Owner", url: SUPPORT_BOT_LINK }]
          ]
        }
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (chatId === OWNER_ID && msg.text) {
      const parts = msg.text.split(" ");
      const cmd = parts[0];

      /* -------- /warn -------- */
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

📊 Total Warnings: ${warns[id].length}/3`
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
`⛔ You have been automatically blocked for 48 hours
due to receiving 3 warnings.`
          });
        }

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: `⚠️ Warn added to ${id}`
        });
        return;
      }

      /* -------- /warnlist -------- */
      if (cmd === "/warnlist") {
        const id = parts[1] || OWNER_ID;
        const warns = readJSON(WARNS_FILE, {});
        const list = warns[id] || [];

        let text =
`📋 Warn List for ${id}

Total Warnings: ${list.length}\n\n`;

        list.forEach((w, i) => {
          text += `${i + 1}. ${w.reason}\n`;
        });

        await tg("sendMessage", {
          chat_id: chatId,
          text: text || "No warnings found."
        });
        return;
      }

      /* -------- /blocklist -------- */
      if (cmd === "/blocklist") {
        const blocks = readJSON(BLOCKS_FILE, {});
        let text = "🚫 Active Blocks\n\n";
        for (const id in blocks) {
          const hrs = Math.ceil(
            (blocks[id].until - now()) / (1000 * 60 * 60)
          );
          text += `• ${id} — ${hrs}h remaining\n`;
        }
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: text || "No active blocks."
        });
        return;
      }

      /* -------- /blockhistory -------- */
      if (cmd === "/blockhistory") {
        const history = readJSON(BLOCK_HISTORY_FILE, []);
        let text = "📜 Block History (last 30 days)\n\n";
        history.forEach(h => {
          text += `• ${h.user_id} — ${h.reason}\n`;
        });
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: text || "No history."
        });
        return;
      }
    }

    /* ================= FORWARD TO OWNER ================= */
    const blueId = `<a href="tg://user?id=${userId}">${userId}</a>`;

    let content = "Non-text message";
    if (msg.text) content = msg.text;
    else if (msg.photo) content = "📷 Photo received";
    else if (msg.document) content = "📎 Document received";
    else if (msg.audio) content = "🎵 Audio received";
    else if (msg.video) content = "🎥 Video received";

    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "HTML",
      text:
`📩 New Support Bot Message

👤 User: @${username}
🆔 User ID: ${blueId}

💬 Message:
${content}`
    });

    await tg("sendMessage", {
      chat_id: chatId,
      text:
"✅ Message received.\nPlease wait for a reply from the owner."
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () =>
  console.log("✅ Amrendra Support Bot running on port", PORT)
);
