const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const SUPPORT_BOT_LINK = process.env.SUPPORT_BOT_LINK || "https://t.me/your_support_bot";
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("BOT_TOKEN or OWNER_ID missing");
}

/* ================= FILES ================= */
const USERS_FILE = path.join(__dirname, "users.json");           // []
const WARNS_FILE = path.join(__dirname, "warns.json");           // {}
const BLOCKS_FILE = path.join(__dirname, "blocks.json");         // {}
const BLOCK_HISTORY_FILE = path.join(__dirname, "block_history.json"); // []

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
  for (const id in warns) {
    warns[id] = warns[id].filter(w => {
      if (w.expires <= now()) {
        tg("sendMessage", { chat_id: id, text: "⚠️ Your warning has expired." });
        tg("sendMessage", { chat_id: OWNER_ID, text: `⚠️ Warn expired for user ${id}` });
        return false;
      }
      return true;
    });
    if (!warns[id].length) delete warns[id];
  }
  writeJSON(WARNS_FILE, warns);
}

/* ================= BLOCK CLEANUP ================= */
function cleanupBlocks() {
  const blocks = readJSON(BLOCKS_FILE, {});
  const history = readJSON(BLOCK_HISTORY_FILE, []);
  const active = {};

  for (const id in blocks) {
    if (blocks[id].until > now()) {
      active[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });
      tg("sendMessage", { chat_id: id, text: "✅ You have been automatically unblocked." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `🔓 User ${id} auto-unblocked` });
    }
  }

  const cutoff = now() - 30 * 24 * 60 * 60 * 1000;
  writeJSON(BLOCKS_FILE, active);
  writeJSON(BLOCK_HISTORY_FILE, history.filter(h => h.expired_at > cutoff));
}

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");

  try {
    cleanupWarns();
    cleanupBlocks();

    const msg = req.body.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const username = msg.from.username || "N/A";
    const isOwner = String(userId) === String(OWNER_ID);

    saveUser({ user_id: userId, username });

    const blocks = readJSON(BLOCKS_FILE, {});
    if (!isOwner && blocks[userId]) {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`⛔ Access Denied

You are blocked by the bot owner.
Reason: ${blocks[userId].reason}

You will be unblocked automatically in 24 hours.

If you believe this is a mistake, contact the owner.`,
        reply_markup: {
          inline_keyboard: [[{ text: "📞 Contact Owner", url: SUPPORT_BOT_LINK }]]
        }
      });
      return;
    }

    /* ================= OWNER COMMANDS ================= */
    if (isOwner && msg.text) {
      const parts = msg.text.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      const cmd = parts[0];

      /* /warn */
      if (cmd === "/warn") {
        const id = parts[1];
        const reason = parts.slice(2).join(" ").replace(/[()]/g, "") || "No reason";
        const warns = readJSON(WARNS_FILE, {});
        warns[id] = warns[id] || [];
        warns[id].push({ reason, expires: now() + 30 * 24 * 60 * 60 * 1000 });
        writeJSON(WARNS_FILE, warns);

        await tg("sendMessage", { chat_id: id, text: `⚠️ You have been warned.\nReason: ${reason}` });

        if (warns[id].length >= 3) {
          const blocks = readJSON(BLOCKS_FILE, {});
          blocks[id] = {
            user_id: id,
            reason: "Auto-block: 3 warnings",
            until: now() + 48 * 60 * 60 * 1000
          };
          writeJSON(BLOCKS_FILE, blocks);
          await tg("sendMessage", { chat_id: id, text: "🚫 You are auto-blocked for 48 hours (3 warnings)." });
        }

        await tg("sendMessage", { chat_id: OWNER_ID, text: `⚠️ Warn added to ${id}` });
        return;
      }

      /* /warnlist */
      if (cmd === "/warnlist") {
        const id = parts[1] || userId;
        const warns = readJSON(WARNS_FILE, {});
        const list = warns[id] || [];
        let text = `⚠️ Warns for ${id}\n\n`;
        list.forEach((w, i) => text += `${i+1}. ${w.reason}\n`);
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /block /block24 */
      if (cmd === "/block" || cmd === "/block24") {
        const id = parts[1];
        const reason = parts.slice(2).join(" ").replace(/[()]/g, "") || "No reason";
        const until = cmd === "/block24"
          ? now() + 24 * 60 * 60 * 1000
          : now() + 100 * 365 * 24 * 60 * 60 * 1000;

        const blocks = readJSON(BLOCKS_FILE, {});
        blocks[id] = { user_id: id, reason, until };
        writeJSON(BLOCKS_FILE, blocks);

        await tg("sendMessage", { chat_id: id, text: `🚫 You are blocked.\nReason: ${reason}` });
        await tg("sendMessage", { chat_id: OWNER_ID, text: `🚫 User ${id} blocked` });
        return;
      }

      /* /unblock */
      if (cmd === "/unblock") {
        const id = parts[1];
        const blocks = readJSON(BLOCKS_FILE, {});
        delete blocks[id];
        writeJSON(BLOCKS_FILE, blocks);
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ User ${id} unblocked` });
        return;
      }

      /* /blocklist */
      if (cmd === "/blocklist") {
        const blocks = readJSON(BLOCKS_FILE, {});
        let text = "🚫 Blocked Users:\n\n";
        for (const id in blocks) {
          const hrs = Math.ceil((blocks[id].until - now()) / 3600000);
          text += `${id} — ${hrs}h left\n`;
        }
        await tg("sendMessage", { chat_id: OWNER_ID, text });
        return;
      }

      /* /blockhistory */
      if (cmd === "/blockhistory") {
        const history = readJSON(BLOCK_HISTORY_FILE, []);
        let text = "📜 Block History (30 days)\n\n";
        history.forEach(h => text += `${h.user_id} — ${h.reason}\n`);
        await tg("sendMessage", { chat_id: OWNER_ID, text });
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
      text: "✅ Message received. Please wait for a reply."
    });

  } catch (e) {
    console.error(e);
  }
});

/* ================= START ================= */
app.listen(PORT, () =>
  console.log("✅ Amrendra Support Bot running on port", PORT)
);
