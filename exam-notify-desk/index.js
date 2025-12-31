const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("Missing BOT_TOKEN or OWNER_ID");
}

// ===== FILE =====
const USERS_FILE = path.join(__dirname, "users.json");

// ===== TELEGRAM HELPER =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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
  const idx = users.findIndex(u => u.user_id === user.user_id);

  if (idx === -1) {
    users.push(user);
  } else {
    users[idx] = { ...users[idx], ...user };
  }

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ===== HEALTH =====
app.get("/", (_, res) => {
  res.send("Exam Notify Desk running");
});

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;

    // ================= VERIFIED RETURN =================
    if (update.message && update.message.text === "/start verified") {
      const chatId = update.message.chat.id;
      const user = update.message.from;

      saveOrUpdateUser({
        user_id: user.id,
        username: user.username || null,
        verified: true
      });

      await tg("sendMessage", {
        chat_id: chatId,
        text:
`✅ You are now an eligible member of this bot.

Please send the name of the exam
or the type of exam-related information
you are looking for.`,
      });

      return res.send("ok");
    }

    // ================= NORMAL START =================
    if (update.message && update.message.text === "/start") {
      const chatId = update.message.chat.id;

      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to Exam Notify Desk 📢

This bot provides important exam-related
updates, notices, and alerts.

🔒 Verification is required to continue.`,
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔐 Verify Access",
              url: "https://t.me/amrendra_verification_bot?start=exam_notify"
            }]
          ]
        }
      });

      return res.send("ok");
    }

    // ================= OWNER → USER MESSAGE =================
    if (
      update.message &&
      String(update.message.chat.id) === OWNER_ID &&
      update.message.text.startsWith("@")
    ) {
      const text = update.message.text.trim();
      const username = text.split("\n")[0].replace("@", "").trim();
      const message = text.replace("@" + username, "").trim();

      const users = loadUsers();
      const target = users.find(u => u.username === username);

      if (!target) {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ User not found."
        });
        return res.send("ok");
      }

      await tg("sendMessage", {
        chat_id: target.user_id,
        text:
`📢 Official Exam Notification

${message}`
      });

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "✅ Message sent successfully."
      });

      return res.send("ok");
    }

    // ================= USER EXAM REQUEST =================
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const user = update.message.from;

      saveOrUpdateUser({
        user_id: user.id,
        username: user.username || null,
        verified: true,
        interest: update.message.text
      });

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
`📩 New Exam Request

👤 User: ${user.username ? "@" + user.username : user.first_name}
🆔 ID: ${user.id}

📘 Interest:
${update.message.text}`
      });

      await tg("sendMessage", {
        chat_id: chatId,
        text:
`✅ Your request has been sent successfully.

You will receive updates related
to this exam here.`
      });

      return res.send("ok");
    }

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log("Exam Notify Desk running on port", PORT);
});
