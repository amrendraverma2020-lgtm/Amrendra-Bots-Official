/*************************************************
 * NEET ASPIRANTS BOT — PART 1
 * CORE USER ENGINE (CLEAN FOUNDATION)
 *************************************************/

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPPORT_BOT_URL = process.env.SUPPORT_BOT_URL;

/* ================= BOT ================= */

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error", err));

/* ================= MODELS ================= */

const User = mongoose.model("User", new mongoose.Schema({
  user_id: Number,
  username: String,
  first_name: String,
  joinedAt: Date,

  totalTests: { type: Number, default: 0 },
  totalScore: { type: Number, default: 0 },

  practiceTests: { type: Number, default: 0 },
  practiceCorrect: { type: Number, default: 0 },
  practiceWrong: { type: Number, default: 0 }
}));

const Question = mongoose.model("Question", new mongoose.Schema({
  date: String,
  type: String, // daily | practice
  q: String,
  options: [String],
  correct: Number,
  reason: String
}));

const Attempt = mongoose.model("Attempt", new mongoose.Schema({
  user_id: Number,
  date: String,
  score: Number,
  timeTaken: Number
}));

/* ================= WEBHOOK ================= */

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(10000, async () => {
  await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
  console.log("🚀 Bot running (PART-1)");
});

/* ================= HELPERS ================= */

const todayDate = () => new Date().toISOString().split("T")[0];
const isOwnerUser = (id) => id === OWNER_ID;

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

/* ================= STATE ================= */

const activeTests = {};
const joinPending = {};

/* ================= /START ================= */

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  let user = await User.findOne({ user_id: chatId });
  if (!user) {
    await User.create({
      user_id: chatId,
      username: msg.from.username || "",
      first_name: msg.from.first_name || "",
      joinedAt: new Date()
    });
  }

  await bot.sendMessage(chatId,
`👋 *Welcome to NEET Aspirants Bot*

Daily Biology Tests
Practice Questions
Progress Tracking`,
    { parse_mode: "Markdown" }
  );

  await bot.sendMessage(chatId,
"🚀 START NOW",
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "🚀 START NOW", callback_data: "main_menu" }]
    ]
  }
});
});

/* ================= FORCE JOIN ================= */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;

  await bot.sendMessage(chatId,
`🔒 *Channel Join Required*

Bot use karne ke liye
channel join karna mandatory hai`,
{
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [{ text: "🔔 Join Channel", url: `https://t.me/${CHANNEL_USERNAME.replace("@","")}` }],
      [{ text: "✅ I have joined", callback_data: "check_join" }]
    ]
  }
});
}

/* ================= CALLBACK ROUTER ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  /* ===== MAIN MENU ===== */
  if (q.data === "main_menu") {
    return bot.sendMessage(chatId,
"🔥 Choose an option",
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "🧬 Daily Test", callback_data: "daily" }],
      [{ text: "🔁 Practice", callback_data: "practice" }],
      [{ text: "📊 My Progress", callback_data: "progress" }],
      [{ text: "☎️ Contact Owner", url: SUPPORT_BOT_URL }]
    ]
  }
});
  }

  /* ===== FORCE JOIN CHECK ===== */
  if (q.data === "check_join") {
    if (await isJoined(userId)) {
      const next = joinPending[userId];
      delete joinPending[userId];
      if (next) {
        return bot.sendMessage(chatId, "✅ Joined successfully");
      }
    }
  }
});

/* ================= PROGRESS ================= */

bot.on("callback_query", async q => {
  if (q.data !== "progress") return;

  const u = await User.findOne({ user_id: q.from.id });
  if (!u) return;

  const avg = u.totalTests
    ? (u.totalScore / u.totalTests).toFixed(1)
    : "0";

  await bot.sendMessage(q.message.chat.id,
`📊 *My Progress*

🧬 Daily Tests
• Attempts: ${u.totalTests}
• Avg Score: ${avg}

🔁 Practice
• Sessions: ${u.practiceTests}`,
{ parse_mode: "Markdown" });
});

/*************************************************
 * NEET ASPIRANTS BOT — PART 2
 * OWNER UPLOAD ENGINE (CLEAN & SAFE)
 *************************************************/

/* ================= OWNER STATE ================= */

const ADMIN = {
  uploads: {} // ownerId -> { type, step, date, buffer }
};

/* ================= HELPERS ================= */

function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ================= OWNER COMMANDS ================= */

/* ===== START DAILY UPLOAD ===== */
bot.onText(/\/upload_daily/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  ADMIN.uploads[msg.from.id] = {
    type: "daily",
    step: "date",
    date: null,
    buffer: ""
  };

  await bot.sendMessage(msg.chat.id,
`📤 *Daily Test Upload*

Send date in format:
YYYY-MM-DD`,
{ parse_mode: "Markdown" });
});

/* ===== START PRACTICE UPLOAD ===== */
bot.onText(/\/upload_practice/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  ADMIN.uploads[msg.from.id] = {
    type: "practice",
    step: "date",
    date: null,
    buffer: ""
  };

  await bot.sendMessage(msg.chat.id,
`📤 *Practice Question Upload*

Send date (grouping only):
YYYY-MM-DD`,
{ parse_mode: "Markdown" });
});

/* ================= OWNER MESSAGE FLOW ================= */

bot.on("message", async (msg) => {
  if (!isOwnerUser(msg.from?.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) return;

  /* ===== DATE STEP ===== */
  if (session.step === "date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(msg.chat.id, "❌ Invalid date format");
    }

    session.date = d;
    session.step = "questions";

    return bot.sendMessage(msg.chat.id,
`📝 Paste questions now.
You can send multiple messages.

When finished, send /done`);
  }

  /* ===== QUESTIONS STEP ===== */
  if (session.step === "questions" && msg.text && !msg.text.startsWith("/")) {
    session.buffer += "\n\n" + msg.text;
    return bot.sendMessage(msg.chat.id, "📝 Questions received");
  }
});

/* ================= QUESTION PARSER ================= */

function parseQuestions(raw) {
  const blocks = raw
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean);

  const out = [];

  for (const b of blocks) {
    const q = b.match(/Q\d*\.?\s*(.+)/i);
    const opts = [...b.matchAll(/^[A-D]\)\s*(.+)$/gm)];
    const ans = b.match(/Ans:\s*([A-D])/i);
    const reason = b.match(/Reason:\s*(.+)/i);

    if (!q || opts.length !== 4 || !ans) continue;

    out.push({
      q: q[1].trim(),
      options: opts.map(o => o[1].trim()),
      correct: ["A","B","C","D"].indexOf(ans[1].toUpperCase()),
      reason: reason ? reason[1].trim() : "Explanation not provided"
    });
  }

  return out;
}

/* ================= /DONE ================= */

bot.onText(/\/done/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) {
    return bot.sendMessage(msg.chat.id, "❌ No active upload session");
  }

  const parsed = parseQuestions(session.buffer);
  if (parsed.length === 0) {
    return bot.sendMessage(msg.chat.id, "❌ No valid questions found");
  }

  if (session.type === "daily" && parsed.length !== 25) {
    return bot.sendMessage(msg.chat.id,
`❌ Daily test must have exactly 25 questions
Detected: ${parsed.length}`);
  }

  await Question.insertMany(parsed.map(q => ({
    ...q,
    date: session.date,
    type: session.type
  })));

  await bot.sendMessage(msg.chat.id,
`✅ Upload successful

📅 Date: ${session.date}
📝 Questions: ${parsed.length}`);

  delete ADMIN.uploads[msg.from.id];
});

/*************************************************
 * NEET ASPIRANTS BOT — PART 3
 * PRACTICE RANDOM ENGINE (SAFE OVERRIDE)
 *************************************************/

/* =================================================
   RANDOM PRACTICE QUESTION PICKER
================================================= */

async function getRandomPracticeQuestions() {
  const total = await Question.countDocuments({ type: "practice" });
  if (total < 25) return [];

  const skip = Math.max(
    0,
    Math.floor(Math.random() * (total - 25))
  );

  return Question.find({ type: "practice" })
    .skip(skip)
    .limit(25);
}

/* =================================================
   OVERRIDE startTest (ONLY FOR PRACTICE)
================================================= */

const originalStartTest_P3 = startTest;

startTest = async function (chatId, userId, type) {
  // DAILY → original flow
  if (type !== "practice") {
    return originalStartTest_P3(chatId, userId, type);
  }

  // FORCE JOIN CHECK
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "practice");
  }

  // RANDOM QUESTIONS
  const qs = await getRandomPracticeQuestions();
  if (!qs.length) {
    return bot.sendMessage(chatId,
      "⏳ Practice questions not available yet.\nTry again later 💪"
    );
  }

  activeTests[userId] = {
    type: "practice",
    date: todayDate(),
    questions: qs,
    index: 0,
    score: 0,
    answered: false,
    startTime: null
  };

  await bot.sendMessage(chatId,
`🔁 *Biology Practice Test*

📝 Total Questions: 25
⏱️ Time Limit: 25 Minutes
📚 Purpose: Learning & concept clarity

👇 Ready? Start below`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start Practice", callback_data: "start_now" }],
          [{ text: "❌ Cancel", callback_data: "main_menu" }]
        ]
      }
    }
  );
};


/*************************************************
 * NEET ASPIRANTS BOT — PART 4
 * ADMIN VIEW / DELETE / EMERGENCY / MIDNIGHT
 * SAFE EXTENSION (NO EXTRA CALLBACK ROUTER)
 *************************************************/

/* =================================================
   EXTEND OWNER CALLBACK HANDLER (PART-4)
================================================= */

const originalOwnerCallbacks_P4 = handleOwnerCallbacks;

handleOwnerCallbacks = async function (data, chatId, userId) {
  // Let PART-2 & PART-3 handle first
  const handled = await originalOwnerCallbacks_P4(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  /* ===== ADMIN MANAGE MENU ===== */
  if (data === "ADMIN_MANAGE") {
    await bot.sendMessage(chatId,
`🛠️ *ADMIN MANAGEMENT*

Choose an action 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 View Daily Tests", callback_data: "ADMIN_VIEW_DAILY" }],
            [{ text: "📋 View Practice Bank", callback_data: "ADMIN_VIEW_PRACTICE" }],
            [{ text: "🗑️ Delete Daily Test", callback_data: "ADMIN_DELETE_DAILY" }],
            [{ text: "🗑️ Delete Practice Bank", callback_data: "ADMIN_DELETE_PRACTICE" }],
            [{ text: "⬅️ Back", callback_data: "OWNER_PANEL" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== VIEW DAILY TESTS ===== */
  if (data === "ADMIN_VIEW_DAILY") {
    const dates = await Question.find({ type: "daily" }).distinct("date");

    await bot.sendMessage(chatId,
`📋 *DAILY TESTS*

${dates.length ? dates.join("\n") : "No daily tests uploaded"}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== VIEW PRACTICE BANK ===== */
  if (data === "ADMIN_VIEW_PRACTICE") {
    const total = await Question.countDocuments({ type: "practice" });

    await bot.sendMessage(chatId,
`📋 *PRACTICE QUESTION BANK*

🧠 Total Questions: ${total}

• Random 25 per attempt
• Unlimited attempts
• No leaderboard`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== DELETE DAILY (ASK DATE) ===== */
  if (data === "ADMIN_DELETE_DAILY") {
    ADMIN.delete = { step: "daily_date" };

    await bot.sendMessage(chatId,
`🗑️ *Delete Daily Test*

Send date:
YYYY-MM-DD`);
    return true;
  }

  /* ===== DELETE PRACTICE (FULL) ===== */
  if (data === "ADMIN_DELETE_PRACTICE") {
    const total = await Question.countDocuments({ type: "practice" });
    await Question.deleteMany({ type: "practice" });

    ownerLog(`Practice bank deleted (${total} Q)`);

    await bot.sendMessage(chatId,
`🗑️ *Practice Bank Deleted*

🧠 Questions removed: ${total}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== FORCE NEW DAY ===== */
  if (data === "ADMIN_FORCE_NEW_DAY") {
    const users = await User.find({});
    let sent = 0;

    for (const u of users) {
      try {
        await bot.sendMessage(u.user_id,
          "🧬 New Biology Test is LIVE!\n25 Questions | 25 Minutes\nAll the best 💪"
        );
        sent++;
      } catch {}
    }

    ownerLog(`Force new day — ${sent} users notified`);

    await bot.sendMessage(chatId,
`✅ *New Day Forced*

📢 Users notified: ${sent}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
};

/* =================================================
   DELETE DAILY — DATE INPUT HANDLER
================================================= */

ADMIN.delete = {};

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;
  if (!ADMIN.delete?.step) return;

  if (ADMIN.delete.step === "daily_date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(msg.chat.id, "❌ Invalid date format");
    }

    const count = await Question.countDocuments({ date: d, type: "daily" });
    await Question.deleteMany({ date: d, type: "daily" });
    await Attempt.deleteMany({ date: d });

    ADMIN.delete = {};

    ownerLog(`Daily test deleted — ${d} (${count} Q)`);

    await bot.sendMessage(msg.chat.id,
`✅ *Daily Test Deleted*

📅 Date: ${d}
🧪 Questions removed: ${count}`,
      { parse_mode: "Markdown" }
    );
  }
});

/* =================================================
   MIDNIGHT REPORT (AUTO)
================================================= */

cron.schedule("0 0 * * *", async () => {
  try {
    const today = todayDate();
    const attempts = await Attempt.countDocuments({ date: today });

    ownerLog(`🌙 Midnight report: ${attempts} daily attempts today`);
  } catch (err) {
    console.error("❌ Midnight cron error:", err);
  }
});

/*************************************************
 * NEET ASPIRANTS BOT — PART 5
 * ANALYTICS + STATUS + MAINTENANCE
 * SAFE EXTENSION (NO EXTRA CALLBACK ROUTER)
 *************************************************/

/* ================= MAINTENANCE STATE ================= */

let MAINTENANCE_MODE = false;

/* =====================================================
   EXTEND OWNER CALLBACK HANDLER (PART-5)
===================================================== */

const originalOwnerCallbacks_P5 = handleOwnerCallbacks;

handleOwnerCallbacks = async function (data, chatId, userId) {
  // Let PART-2 → PART-4 handle first
  const handled = await originalOwnerCallbacks_P5(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  /* ===== ANALYTICS ===== */
  if (data === "ADMIN_ANALYTICS") {
    const totalUsers = await User.countDocuments();
    const today = todayDate();

    const todayAttempts = await Attempt.countDocuments({ date: today });

    const avgAgg = await Attempt.aggregate([
      { $match: { date: today } },
      { $group: { _id: null, avg: { $avg: "$score" } } }
    ]);

    const avgScore = avgAgg.length
      ? avgAgg[0].avg.toFixed(1)
      : "0";

    const practiceAgg = await User.aggregate([
      {
        $group: {
          _id: null,
          sessions: { $sum: "$practiceTests" },
          correct: { $sum: "$practiceCorrect" },
          wrong: { $sum: "$practiceWrong" }
        }
      }
    ]);

    const p = practiceAgg[0] || { sessions: 0, correct: 0, wrong: 0 };
    const acc = p.correct + p.wrong
      ? ((p.correct / (p.correct + p.wrong)) * 100).toFixed(1)
      : "0";

    await bot.sendMessage(chatId,
`📊 *BOT ANALYTICS*

👥 Total Users: ${totalUsers}

🧬 Daily Test (Today)
• Attempts: ${todayAttempts}
• Avg Score: ${avgScore} / 25

🔁 Practice
• Sessions: ${p.sessions}
• Accuracy: ${acc} %

⚙️ Status: Running`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== BOT STATUS ===== */
  if (data === "ADMIN_STATUS") {
    await bot.sendMessage(chatId,
`📡 *BOT STATUS*

🟢 Bot: Online
🟢 Database: Connected
🔒 Maintenance: ${MAINTENANCE_MODE ? "ON" : "OFF"}
⏱️ Server Time: ${new Date().toLocaleString()}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== MAINTENANCE ON ===== */
  if (data === "ADMIN_MAINT_ON") {
    MAINTENANCE_MODE = true;
    ownerLog("Maintenance mode ENABLED");

    await bot.sendMessage(chatId,
`🔒 *Maintenance Enabled*

Users ko temporarily block kar diya gaya hai.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== MAINTENANCE OFF ===== */
  if (data === "ADMIN_MAINT_OFF") {
    MAINTENANCE_MODE = false;
    ownerLog("Maintenance mode DISABLED");

    await bot.sendMessage(chatId,
`✅ *Maintenance Disabled*

Bot normal mode me aa gaya hai.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
};

/* =================================================
   MAINTENANCE CHECK (GLOBAL USER BLOCK)
================================================= */

const originalStartTest_P5 = startTest;

startTest = async function (chatId, userId, type) {
  if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
    return bot.sendMessage(chatId,
`🔧 *Bot Under Maintenance*

Thodi der baad try karein 🙏`,
      { parse_mode: "Markdown" }
    );
  }
  return originalStartTest_P5(chatId, userId, type);
};


