// =======================
//  BASIC SETUP
// =======================
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// =======================
//  EXPRESS APP
// =======================
const app = express();
app.use(bodyParser.json());

// =======================
//  TELEGRAM BOT
// =======================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in ENV");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

// =======================
//  MONGODB CONNECTION
// =======================
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI, {
    dbName: "neet_bot"
  })
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB Error:", err.message);
  });

// =======================
//  USER SCHEMA
// =======================
const userSchema = new mongoose.Schema({
  user_id: { type: Number, unique: true },
  username: String,
  first_name: String,
  joinedAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

// =======================
//  WEBHOOK ROUTE
// =======================
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// =======================
//  ROOT ROUTE (TEST)
// =======================
app.get("/", (req, res) => {
  res.send("🚀 NEET Aspirants Bot is running");
});

// =======================
//  BOT COMMANDS
// =======================

// /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await User.updateOne(
      { user_id: msg.from.id },
      {
        user_id: msg.from.id,
        username: msg.from.username,
        first_name: msg.from.first_name
      },
      { upsert: true }
    );

    bot.sendMessage(
      chatId,
      "👋 Welcome to *NEET Aspirants Bot*\n\n✅ Bot is working properly.\n📘 Daily tests coming soon!",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("User save error:", err.message);
    bot.sendMessage(chatId, "❌ Something went wrong. Try again.");
  }
});

// simple alive reply (IMPORTANT)
bot.on("message", (msg) => {
  if (!msg.text.startsWith("/")) {
    bot.sendMessage(msg.chat.id, "✅ Bot alive");
  }
});

// =======================
//  SERVER START
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const renderURL = process.env.RENDER_URL;
  if (renderURL) {
    console.log("✅ Webhook set");
  } else {
    console.log("⚠️ RENDER_URL not set");
  }
});
