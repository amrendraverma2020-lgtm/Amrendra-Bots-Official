/**
 * ============================================================
 * AMRENDRA SUPPORT BOT
 * FINAL • LOCKED • FULLY FUNCTIONAL
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
const USERS = path.join(__dirname, "users.json");
const WARNS = path.join(__dirname, "warns.json");
const BLOCKS = path.join(__dirname, "blocks.json");
const HISTORY = path.join(__dirname, "block_history.json");

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
  const list = read(USERS, []);
  if (!list.find(u => u.user_id === id)) {
    list.push({ user_id: id, username });
    write(USERS, list);
  }
}

/* ================= CLEANUP ================= */
function cleanup() {
  /* WARN EXPIRY */
  const warns = read(WARNS, {});
  for (const id in warns) {
    const active = warns[id].filter(w => w.expires > now());
    if (active.length !== warns[id].length) {
      tg("sendMessage", { chat_id: id, text: "ℹ️ One of your warnings has expired." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `ℹ️ Warning expired for ${id}` });
    }
    active.length ? warns[id] = active : delete warns[id];
  }
  write(WARNS, warns);

  /* BLOCK EXPIRY */
  const blocks = read(BLOCKS, {});
  const hist = read(HISTORY, []);
  const activeBlocks = {};
  for (const id in blocks) {
    if (blocks[id].until > now()) activeBlocks[id] = blocks[id];
    else {
      hist.push({ ...blocks[id], expired_at: now() });
      tg("sendMessage", { chat_id: id, text: "✅ You have been automatically unblocked." });
      tg("sendMessage", { chat_id: OWNER_ID, text: `🔓 User ${id} auto-unblocked` });
    }
  }
  write(BLOCKS, activeBlocks);
  write(HISTORY, hist.filter(h => h.expired_at > now() - 30*24*60*60*1000));
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
    const blocks = read(BLOCKS, {});
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
        parse_mode: "Markdown",
        text:
`👋 *Welcome to Amrendra Support Bot*

📌 Send your issue in ONE message.
📨 It will be forwarded to the support team.
⏳ You will receive reply here itself.

⚠️ Misuse may lead to temporary block.`
      });
      return;
    }

    /* OWNER COMMANDS */
    if (chatId === OWNER_ID && msg.text) {
      const p = msg.text.split(" ");
      const cmd = p[0];
      const target = p[1];

      if (target === OWNER_ID) {
        await tg("sendMessage", { chat_id: OWNER_ID, text: "❌ You cannot target yourself." });
        return;
      }

      /* WARN */
      if (cmd === "/warn") {
        const reason = p.slice(2).join(" ") || "No reason";
        const warns = read(WARNS, {});
        warns[target] = warns[target] || [];
        warns[target].push({ reason, expires: now()+30*24*60*60*1000 });
        write(WARNS, warns);

        await tg("sendMessage", { chat_id: target, text: `⚠️ Warning\nReason: ${reason}` });

        if (warns[target].length >= 3) {
          const blocks = read(BLOCKS, {});
          blocks[target] = {
            reason: "Auto-block (3 warnings)",
            duration: "48 hours",
            until: now()+48*60*60*1000
          };
          write(BLOCKS, blocks);
          await tg("sendMessage", { chat_id: target, text: "⛔ Auto-blocked for 48 hours (3 warnings)" });
        }

        await tg("sendMessage", { chat_id: OWNER_ID, text: `⚠️ Warn added to ${target}` });
        return;
      }

      /* WARNLIST */
      if (cmd === "/warnlist") {
        const id = target || OWNER_ID;
        const warns = read(WARNS, {});
        const list = warns[id] || [];
        let text = `⚠️ Warns for ${id}\n\n`;
        text += list.length ? list.map((w,i)=>`${i+1}. ${w.reason}`).join("\n") : "No active warnings.";
        await tg("sendMessage", { chat_id: chatId, text });
        return;
      }

      /* BLOCK */
      if (cmd === "/block" || cmd === "/block24") {
        const reason = p.slice(2).join(" ") || "No reason";
        const blocks = read(BLOCKS, {});
        blocks[target] = {
          reason,
          duration: cmd==="/block24"?"24 hours":"Permanent",
          until: cmd==="/block24"?now()+24*60*60*1000:now()+100*365*24*60*60*1000
        };
        write(BLOCKS, blocks);
        await tg("sendMessage", { chat_id: target, text: `⛔ Blocked\nReason: ${reason}` });
        await tg("sendMessage", { chat_id: OWNER_ID, text: `🚫 User ${target} blocked` });
        return;
      }

      /* UNBLOCK */
      if (cmd === "/unblock") {
        const blocks = read(BLOCKS, {});
        delete blocks[target];
        write(BLOCKS, blocks);
        await tg("sendMessage", { chat_id: target, text: "✅ You have been unblocked." });
        await tg("sendMessage", { chat_id: OWNER_ID, text: `✅ User ${target} unblocked` });
        return;
      }

      /* OWNER REPLY */
      if (!cmd.startsWith("/")) {
        await tg("sendMessage", {
          chat_id: cmd,
          text: `📩 Support Reply\n\n${p.slice(1).join(" ")}`
        });
        return;
      }
    }

    /* FORWARD USER MESSAGE */
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
      text: "✅ Message received. Please wait for reply."
    });

  } catch (e) {
    console.error("BOT ERROR:", e);
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("✅ Amrendra Support Bot LIVE");
});
