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

if (!BOT_TOKEN || !OWNER_ID) throw new Error("ENV missing");

/* ================= FILES ================= */
const USERS = "users.json";
const WARNS = "warns.json";
const BLOCKS = "blocks.json";
const HISTORY = "block_history.json";

/* ================= UTILS ================= */
const r = (f, d) => { try { return JSON.parse(fs.readFileSync(f)); } catch { return d; } };
const w = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const now = () => Date.now();

/* ================= TG ================= */
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ================= SAVE USER ================= */
function saveUser(u) {
  const list = r(USERS, []);
  if (!list.find(x => x.user_id === u.user_id)) {
    list.push({ ...u, joined_at: now() });
    w(USERS, list);
  }
}

/* ================= CLEANUP ================= */
function cleanup() {
  const blocks = r(BLOCKS, {});
  const history = r(HISTORY, []);
  const active = {};

  for (const id in blocks) {
    if (blocks[id].until > now()) {
      active[id] = blocks[id];
    } else {
      history.push({ ...blocks[id], expired_at: now() });
      tg("sendMessage", {
        chat_id: id,
        text: "✅ You are now unblocked. You may contact support again."
      });
      tg("sendMessage", {
        chat_id: OWNER_ID,
        text: `🔓 User ${id} auto-unblocked`
      });
    }
  }

  w(BLOCKS, active);
  w(HISTORY, history.filter(h => h.expired_at > now() - 30*24*60*60*1000));

  const warns = r(WARNS, {});
  for (const id in warns) {
    warns[id] = warns[id].filter(w => w.expires > now());
    if (!warns[id].length) delete warns[id];
  }
  w(WARNS, warns);
}

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");
  cleanup();

  const msg = req.body.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const userId = String(msg.from.id);
  const username = msg.from.username || "N/A";
  const name = msg.from.first_name || "";

  saveUser({ user_id: userId, username, name });

  /* ===== BLOCK CHECK ===== */
  const blocks = r(BLOCKS, {});
  if (blocks[userId]) {
    const b = blocks[userId];
    const hrs = Math.ceil((b.until - now()) / 3600000);

    await tg("sendMessage", {
      chat_id: chatId,
      text:
`⛔ Access Denied

You are blocked by the support team.

📝 Reason:
${b.reason}

⏳ Block Duration: ${hrs} hours
You will be automatically unblocked.

Please wait patiently.`
    });
    return;
  }

  /* ===== OWNER DIRECT REPLY ===== */
  if (chatId === OWNER_ID && msg.text) {
    const lines = msg.text.split("\n");
    if (lines.length >= 2 && /^\d+$/.test(lines[0])) {
      const target = lines[0].trim();
      if (target === OWNER_ID) {
        await tg("sendMessage", { chat_id: OWNER_ID, text: "⚠️ You cannot block or message yourself." });
        return;
      }

      await tg("sendMessage", {
        chat_id: target,
        text:
`📩 Message from Support Team

${lines.slice(1).join("\n")}`
      });

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "✅ Message sent successfully."
      });
      return;
    }
  }

  /* ===== OWNER COMMANDS ===== */
  if (chatId === OWNER_ID && msg.text) {
    const [cmd, id, ...rest] = msg.text.split(" ");
    const reason = rest.join(" ") || "No reason provided";

    if (id === OWNER_ID) {
      await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ You cannot block yourself." });
      return;
    }

    if (cmd === "/warn") {
      const warns = r(WARNS, {});
      warns[id] = warns[id] || [];
      warns[id].push({ reason, expires: now()+30*24*60*60*1000 });
      w(WARNS, warns);

      await tg("sendMessage", {
        chat_id: id,
        text:
`⚠️ Warning Issued

Reason:
${reason}

Please follow the rules.`
      });

      if (warns[id].length >= 3) {
        const blocks = r(BLOCKS, {});
        blocks[id] = {
          user_id: id,
          reason: "Auto-block due to 3 warnings",
          until: now()+48*60*60*1000
        };
        w(BLOCKS, blocks);

        await tg("sendMessage", {
          chat_id: id,
          text:
`⛔ You have been automatically blocked.

Reason:
3 warnings received.

⏳ Duration: 48 hours`
        });
      }

      await tg("sendMessage", { chat_id: OWNER_ID, text: "⚠️ Warn added." });
      return;
    }

    if (cmd === "/block" || cmd === "/block24") {
      const until = cmd === "/block24"
        ? now()+24*60*60*1000
        : now()+100*365*24*60*60*1000;

      const blocks = r(BLOCKS, {});
      blocks[id] = { user_id: id, reason, until };
      w(BLOCKS, blocks);

      await tg("sendMessage", {
        chat_id: id,
        text:
`⛔ You are blocked from Support

Reason:
${reason}

⏳ Duration: ${cmd==="/block24"?"24 hours":"Permanent"}`
      });

      await tg("sendMessage", { chat_id: OWNER_ID, text: "🚫 User blocked." });
      return;
    }

    if (cmd === "/unblock") {
      const blocks = r(BLOCKS, {});
      delete blocks[id];
      w(BLOCKS, blocks);

      await tg("sendMessage", {
        chat_id: id,
        text: "✅ You are now unblocked."
      });

      await tg("sendMessage", { chat_id: OWNER_ID, text: "🔓 User unblocked." });
      return;
    }
  }

  /* ===== USER MESSAGE ===== */
  await tg("sendMessage", {
    chat_id: OWNER_ID,
    parse_mode: "HTML",
    text:
`📩 New Support Message

👤 User: @${username}
🆔 User ID: <a href="tg://user?id=${userId}">${userId}</a>

💬 Message:
${msg.text || "Non-text message"}`
  });

  await tg("sendMessage", {
    chat_id: chatId,
    text:
`✅ Message Received Successfully

Your message has been sent to the support team.
You will receive a reply here.

Please wait patiently.`
  });
});

/* ================= START ================= */
app.listen(PORT, () =>
  console.log("✅ Amrendra Support Bot LIVE on port", PORT)
);
