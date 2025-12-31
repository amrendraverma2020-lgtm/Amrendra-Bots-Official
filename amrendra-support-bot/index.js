const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const PORT = process.env.PORT || 10000;

// ===== FILES =====
const USERS_FILE = path.join(__dirname, "users.json");
const BLOCKED_FILE = path.join(__dirname, "blocked.json");

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Amrendra Support Bot is running");
});

// ===== TELEGRAM SEND =====
async function sendMessage(chatId, text, markdown = false) {
  const payload = { chat_id: chatId, text };
  if (markdown) payload.parse_mode = "Markdown";

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ===== USER STORAGE =====
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveOrUpdateUser(user) {
  const users = loadUsers();
  const i = users.findIndex(u => u.user_id === user.user_id);
  if (i === -1) users.push(user);
  else users[i] = { ...users[i], ...user };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ===== BLOCK SYSTEM =====
function loadBlocked() {
  try {
    return JSON.parse(fs.readFileSync(BLOCKED_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveBlocked(list) {
  fs.writeFileSync(BLOCKED_FILE, JSON.stringify(list, null, 2));
}

function cleanupExpiredBlocks() {
  const now = Date.now();
  const active = loadBlocked().filter(b => b.until > now);
  saveBlocked(active);
}

function getBlock(username) {
  cleanupExpiredBlocks();
  return loadBlocked().find(b => b.username === username);
}

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.send("ok");

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || null;
    const displayName = username ? `@${username}` : msg.from.first_name;

    // ===== OWNER COMMANDS =====

    // /block username (24h)
    if (chatId === OWNER_ID && msg.text?.startsWith("/block ")) {
      const uname = msg.text.replace("/block", "").trim();
      const blocked = loadBlocked();
      const until = Date.now() + 24 * 60 * 60 * 1000;

      const existing = blocked.find(b => b.username === uname);
      if (existing) existing.until = until;
      else blocked.push({ username: uname, until });

      saveBlocked(blocked);
      await sendMessage(OWNER_ID, `🚫 @${uname} blocked for 24 hours.`);
      return res.send("ok");
    }

    // /unblock username
    if (chatId === OWNER_ID && msg.text?.startsWith("/unblock ")) {
      const uname = msg.text.replace("/unblock", "").trim();
      saveBlocked(loadBlocked().filter(b => b.username !== uname));
      await sendMessage(OWNER_ID, `✅ @${uname} unblocked.`);
      return res.send("ok");
    }

    // /blocked
    if (chatId === OWNER_ID && msg.text === "/blocked") {
      cleanupExpiredBlocks();
      const blocked = loadBlocked();

      if (!blocked.length) {
        await sendMessage(OWNER_ID, "✅ No users are currently blocked.");
        return res.send("ok");
      }

      let text = "🚫 Blocked Users (24h)\n\n";
      blocked.forEach(b => {
        const hrs = Math.ceil((b.until - Date.now()) / (1000 * 60 * 60));
        text += `• @${b.username} (expires in ${hrs}h)\n`;
      });

      await sendMessage(OWNER_ID, text);
      return res.send("ok");
    }

    // OWNER → @username reply
    if (chatId === OWNER_ID && msg.text?.startsWith("@")) {
      const uname = msg.text.split("\n")[0].replace("@", "").trim();
      const reply = msg.text.replace("@" + uname, "").trim();
      const users = loadUsers();
      const target = users.find(u => u.username === uname);

      if (!target) {
        await sendMessage(OWNER_ID, "❌ User not found.");
        return res.send("ok");
      }

      await sendMessage(
        target.user_id,
`📩 Support Team Reply

${reply}`
      );

      await sendMessage(OWNER_ID, "✅ Message sent successfully.");
      return res.send("ok");
    }

    // ===== /start =====
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "👋 *Welcome to Amrendra Support Bot* 🤖\n\n" +
          "Thank you for reaching out.\n\n" +
          "📝 You can send your:\n" +
          "• Queries\n" +
          "• Issues\n" +
          "• Feedback\n" +
          "• Suggestions\n\n" +
          "📩 Your message will be securely forwarded to the owner.\n\n" +
          "⏳ Please allow some time for a response.",
        true
      );
      return res.send("ok");
    }

    if (msg.text && msg.text.startsWith("/")) {
      return res.send("ok");
    }

    // ===== BLOCK CHECK =====
    const block = getBlock(username);
    if (block) {
      await sendMessage(
        chatId,
`🚫 Access Restricted

You are temporarily blocked from contacting
the support team.

⏳ Block expires automatically.`
      );
      return res.send("ok");
    }

    // ===== SAVE USER =====
    saveOrUpdateUser({ user_id: userId, username });

    // ===== FORWARD TO OWNER =====
    let forwardText =
      "📩 New Support Message\n\n" +
      `👤 User: ${displayName}\n` +
      `🆔 User ID: ${userId}\n\n`;

    if (msg.text) forwardText += `💬 Message:\n${msg.text}`;
    else if (msg.photo) forwardText += "📷 Photo received";
    else if (msg.document) forwardText += "📎 Document received";
    else forwardText += "📩 New message received";

    await sendMessage(OWNER_ID, forwardText);

    // ===== CONFIRM USER =====
    await sendMessage(
      chatId,
      "✅ *Message Received Successfully*\n\n" +
        "Your message has been forwarded to the support team.\n\n" +
        "⏳ You will be notified once a response is available.",
      true
    );

    return res.send("ok");
  } catch (err) {
    console.error(err);
    return res.send("ok");
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log("Amrendra Support Bot running on port", PORT);
});
