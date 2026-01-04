/**
 * ============================================================
 * NEET ASPIRANTS BOT (BIOLOGY FOUNDATION)
 * REAL • STABLE • MONGODB POWERED
 * ============================================================
 */

require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !MONGO_URI) {
  throw new Error("BOT_TOKEN or MONGO_URI missing");
}

/* ================= TELEGRAM ================= */
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json()).catch(() => {});
}

/* ================= MONGODB ================= */
const client = new MongoClient(MONGO_URI);
let usersCollection;

async function connectDB() {
  await client.connect();
  const db = client.db("neet_bot");
  usersCollection = db.collection("users");
  console.log("✅ MongoDB connected");
}
connectDB();

/* ================= HELPERS ================= */
const now = () => new Date();

/* ================= WEBHOOK ================= */
app.post("/", async (req, res) => {
  res.send("ok");

  try {
    const update = req.body;
    if (!update.message) return;

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const username = msg.from.username || "N/A";

    /* ================= SAVE / UPDATE USER ================= */
    await usersCollection.updateOne(
      { user_id: userId },
      {
        $set: {
          username,
          last_active: now()
        },
        $setOnInsert: {
          joined_at: now()
        }
      },
      { upsert: true }
    );

    /* ================= /START ================= */
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
`👋 Welcome to NEET Aspirants Bot 🧬

🔥 This bot will help you with:
• Daily NEET-level Biology tests
• Timed practice (exam feel)
• Score & leaderboard system

📌 How it works:
• Join & stay active
• Daily test will be shared automatically
• Compete with other NEET aspirants

⏳ Note:
Bot may take 30–60 seconds to start if server was sleeping.

🚀 Stay consistent. Stay sharp.`
      });
      return;
    }

    /* ================= NORMAL MESSAGE ================= */
    await tg("sendMessage", {
      chat_id: chatId,
      text:
`✅ Message received!

Daily Biology Test system is being prepared 🔥  
Please stay active to receive daily tests.

📚 Consistency = Selection 💪`
    });

  } catch (err) {
    console.error("BOT ERROR:", err);
  }
});

/* ================= SERVER ================= */
app.listen(PORT, () => {
  console.log(`🚀 NEET Bot running on port ${PORT}`);
});
