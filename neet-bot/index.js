/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 0
 * FOUNDATION (CONFIG + BOT + DB + SERVER)
 * FINAL • CLEAN • NO DUPLICATE
 *************************************************/

require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const express = require("express");

/* ================= ENV CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPPORT_BOT_URL = process.env.SUPPORT_BOT_URL;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !OWNER_ID || !CHANNEL_USERNAME || !MONGO_URI) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

/* ================= BOT INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, {
  webHook: {
    port: 10000
  }
});

const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });

/* ================= WEBHOOK ================= */

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(10000, async () => {
  await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
  console.log("🚀 Bot Running (BLOCK-0 READY)");
});

/* ================= HELPERS ================= */

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

function isOwner(id) {
  return Number(id) === OWNER_ID;
}

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);

    return ["member", "administrator", "creator"].includes(m.status);

  } catch (e) {
    return false;
  }
}

/* ================= GLOBAL STATES ================= */

// Active Test Sessions
const activeTests = {};

// Pending Force Join
const joinPending = {};

// Maintenance Flag
let MAINTENANCE_MODE = false;

/* ================= OWNER HOOK SYSTEM ================= */

// Multiple admin modules safe add
bot._ownerHook = [];

/* ================= EXPORT (FOR NEXT BLOCKS) ================= */

// (Keep variables global — next blocks will use directly)
