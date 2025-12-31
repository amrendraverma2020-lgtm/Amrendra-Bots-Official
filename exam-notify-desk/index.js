const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const VERIFY_BOT = "amrendra_verification_bot";
const SUPPORT_BOT = "amrendra_support_bot";
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !OWNER_ID) {
  throw new Error("Missing BOT_TOKEN or OWNER_ID");
}

// ===== FILE =====
const USERS_FILE = path.join(__dirname, "users.json");

// ===== HELPERS =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function upsertUser(user) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.user_id === user.user_id);
  if (idx === -1) users.push(user);
  else users[idx] = { ...users[idx], ...user };
  saveUsers(users);
}

// ===== HEALTH =====
app.get("/", (_, res) => res.send("Exam Notify Desk running"));

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;

    // ================= /start =================
    if (update.message && update.message.text === "/start") {
      const chatId = update.message.chat.id;

      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to Exam Notify Desk 📢

This bot provides important exam-related
updates, notices, and alerts.


🔒 Access to this bot is limited.
Verification is required to continue.


✅ Once verified, you may proceed.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔔 Verify Access",
                url: `https://t.me/${VERIFY_BOT}?start=exam_notify`
              }
            ],
            [
              {
                text: "📩 Contact Support",
                url: `https://t.me/${SUPPORT_BOT}?start=exam_notify`
              }
            ]
          ]
        }
      });

      return res.send("ok");
    }

    // ================= VERIFICATION CALLBACK =================
    // Verification bot should redirect user with: /verified
    if (update.message && update.message.text === "/verified") {
      const msg = update.message;
      const user = {
        user_id: msg.from.id,
        username: msg.from.username || null,
        verified: true,
        exam_interest: null
      };

      upsertUser(user);

      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text:
`✅ Verification Successful!

You are now an eligible member of this bot.

You can now send the name of the exam
or the type of exam-related information
you are looking for.

Our team will review your request
and keep you updated accordingly.`
      });

      return res.send("ok");
    }

    // ================= USER EXAM REQUEST =================
    if (update.message && update.message.text) {
      const msg = update.message;
      const text = msg.text.trim();

      // Ignore owner admin replies
      if (String(msg.chat.id) === OWNER_ID && text.startsWith("@")) {
        const parts = text.split("\n");
        const username = parts[0].replace("@", "").trim();
        const replyText = parts.slice(1).join("\n").trim();

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
`📢 Exam Update

${replyText}`
        });

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "✅ Message sent to user."
        });

        return res.send("ok");
      }

      // Normal user message (exam interest)
      const users = loadUsers();
      const user = users.find(u => u.user_id === msg.from.id);

      if (!user || !user.verified) {
        return res.send("ok");
      }

      upsertUser({
        ...user,
        exam_interest: text
      });

      // Forward to owner
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
`📩 New Exam Request

👤 User: ${msg.from.username ? "@" + msg.from.username : "No username"}
🆔 User ID: ${msg.from.id}

📝 Request:
${text}`
      });

      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text:
`📨 Request Sent Successfully!

Your message has been forwarded
to the managing team.

You will receive updates related
to this exam as soon as they are available.`
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
