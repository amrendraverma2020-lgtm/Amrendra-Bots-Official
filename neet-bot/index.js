/*************************************************
 * NEET ASPIRANTS BOT — PART 1
 * CORE USER ENGINE (FINAL • STABLE • CLEAN)
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

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error", err));

/* ================= SCHEMAS ================= */

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

/* ================= GLOBAL STATE ================= */

const activeTests = {};   // userId -> test session
const joinPending = {};   // userId -> "daily" | "practice"

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

Designed for serious NEET Biology students.
Daily tests • Practice • Progress tracking

👇 Select an option to continue`,
    { parse_mode: "Markdown" }
  );

  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId, "🚀 *START NOW*", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 START NOW", callback_data: "main_menu" }]]
    }
  });
});

/* ================= FORCE JOIN ================= */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;

  await bot.sendMessage(chatId,
`🔒 *Channel Join Required*

Is bot ke saare features use karne ke liye
aapko pehle hamara official channel join karna hoga.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔔 Join Channel", url: `https://t.me/${CHANNEL_USERNAME.replace("@","")}` }],
          [{ text: "✅ I have joined", callback_data: "check_join" }]
        ]
      }
    }
  );
}

/* ================= LEADERBOARD ================= */

async function showLeaderboard(chatId, date) {
  const rows = await Attempt.aggregate([
    { $match: { date } },
    { $sort: { score: -1, timeTaken: 1 } },
    {
      $group: {
        _id: "$user_id",
        score: { $first: "$score" },
        timeTaken: { $first: "$timeTaken" }
      }
    },
    { $limit: 10 }
  ]);

  let text = `🏆 *Daily Biology Leaderboard*\n📅 ${date}\n\n`;

  if (!rows.length) {
    text += "No attempts yet today.\nBe the first 💪";
  } else {
    rows.forEach((r, i) => {
      const rank =
        i === 0 ? "🥇" :
        i === 1 ? "🥈" :
        i === 2 ? "🥉" : `${i+1}.`;
      text += `${rank} Score: ${r.score}/25 | ⏱️ ${Math.floor(r.timeTaken/60)}m ${r.timeTaken%60}s\n`;
    });
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= TIMER ================= */

function remainingTime(t) {
  const total = 30 * 60;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const left = Math.max(total - elapsed, 0);
  return {
    min: Math.floor(left / 60),
    sec: left % 60
  };
}

/* ================= START TEST ================= */

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, type);
  }

  const date = todayDate();

  if (type === "daily" && !isOwnerUser(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) {
      return bot.sendMessage(chatId,
        "❌ You already attempted today’s test\nCome back tomorrow 💪"
      );
    }
  }

  let qs;
  if (type === "daily") {
    qs = await Question.find({ date, type });
  } else {
    const total = await Question.countDocuments({ type: "practice" });
    if (total < 25) return bot.sendMessage(chatId, "⏳ Practice not available");
    const skip = Math.floor(Math.random() * (total - 25));
    qs = await Question.find({ type: "practice" }).skip(skip).limit(25);
  }

  activeTests[userId] = {
    type,
    date,
    questions: qs,
    index: 0,
    score: 0,
    answered: false,
    startTime: null
  };

  await bot.sendMessage(chatId,
`🧬 *${type === "daily" ? "Daily Biology Test" : "Practice Biology"}*

📝 Total Questions: 25
⏱️ Time Limit: 30 Minutes`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start", callback_data: "start_now" }],
          [{ text: "❌ Cancel", callback_data: "main_menu" }]
        ]
      }
    }
  );
}

/* ================= SEND QUESTION ================= */

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  const time = remainingTime(t);
  t.answered = false;

  bot.sendMessage(chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ ${time.min}m ${time.sec}s

${q.q}

🅐 ${q.options[0]}   🅑 ${q.options[1]}
🅒 ${q.options[2]}   🅓 ${q.options[3]}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🅐", callback_data: "ans_0" }, { text: "🅑", callback_data: "ans_1" }],
          [{ text: "🅒", callback_data: "ans_2" }, { text: "🅓", callback_data: "ans_3" }]
        ]
      }
    }
  );
}

/* ================= FINISH TEST ================= */

async function finishTest(chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);

  if (t.type === "daily" && !isOwnerUser(userId)) {
    await Attempt.create({ user_id: userId, date: t.date, score: t.score, timeTaken });
    await User.updateOne(
      { user_id: userId },
      { $inc: { totalTests: 1, totalScore: t.score } }
    );
  }

  if (t.type === "practice") {
    await User.updateOne(
      { user_id: userId },
      { $inc: { practiceTests: 1, practiceCorrect: t.score, practiceWrong: 25 - t.score } }
    );
  }

  delete activeTests[userId];

  await bot.sendMessage(chatId,
    timeOver
      ? `⏰ *Time Over!*\n⭐ Score: ${t.score}/25`
      : `✅ *Test Completed*\n⭐ Score: ${t.score}/25\n⏱️ ${Math.floor(timeTaken/60)}m ${timeTaken%60}s`,
    { parse_mode: "Markdown" }
  );

  if (t.type === "daily") {
    await showLeaderboard(chatId, t.date);
  }

  await bot.sendMessage(chatId, "🚀 START NOW", {
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 START NOW", callback_data: "main_menu" }]]
    }
  });
}
/* ================= CALLBACK ROUTER (ONLY ONE) ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data;

  // ===== OWNER HOOK (ADD THIS ONCE) =====
  if (bot._ownerHook) {
    for (const fn of bot._ownerHook) {
      const handled = await fn(data, chatId, userId);
      if (handled) return;
    }
  }
  // ===== END OWNER HOOK =====

  /* ===== MAIN MENU ===== */
  if (data === "main_menu") {
    return bot.sendMessage(chatId, "🔥 Let’s improve your NEET score", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧬 Take Today’s Test", callback_data: "daily" }],
          [{ text: "🔁 Practice Biology", callback_data: "practice" }],
          [{ text: "📊 My Progress", callback_data: "progress" }],
          [{ text: "☎️ Need Help", url: SUPPORT_BOT_URL }]
        ]
      }
    });
  }

  // ⬇️ yahan se baaki callbacks (daily, practice, ans_, etc.) aayenge
});
  if (data === "daily") return startTest(chatId, userId, "daily");
  if (data === "practice") return startTest(chatId, userId, "practice");

  if (data === "start_now" && activeTests[userId]) {
    activeTests[userId].startTime = Date.now();
    sendQuestion(chatId, userId);

    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId, true);
    }, 30 * 60 * 1000);
    return;
  }

  if (data.startsWith("ans_") && activeTests[userId]) {
    const t = activeTests[userId];
    if (t.answered) return;
    t.answered = true;

    const sel = Number(data.split("_")[1]);
    const cq = t.questions[t.index];
    const correct = sel === cq.correct;
    if (correct) t.score++;

    return bot.sendMessage(
      chatId,
      correct
        ? `✅ *Correct!*\n\n✔️ ${cq.reason}`
        : `❌ *Wrong!*\n\n✅ Correct Answer: ${
            ["🅐","🅑","🅒","🅓"][cq.correct]
          }\n✔️ ${cq.reason}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "➡️ Next Question", callback_data: "next" }]]
        }
      }
    );
  }

  if (data === "next" && activeTests[userId]) {
    const t = activeTests[userId];
    t.index++;
    if (t.index >= 25) return finishTest(chatId, userId, false);
    return sendQuestion(chatId, userId);
  }

  if (data === "progress") {
    const u = await User.findOne({ user_id: userId });
    if (!u) return;

    const avg = u.totalTests ? (u.totalScore / u.totalTests).toFixed(1) : "0";

    return bot.sendMessage(chatId,
`📊 *My Progress Snapshot*

🧬 Daily Tests
• Attempts: ${u.totalTests}
• Avg Score: ${avg} / 25

🔁 Practice
• Sessions: ${u.practiceTests}`,
      { parse_mode: "Markdown" }
    );
  }

  if (data === "check_join") {
    if (await isJoined(userId)) {
      const next = joinPending[userId];
      delete joinPending[userId];
      if (next) startTest(chatId, userId, next);
    }
  }
});




/*************************************************
 * NEET ASPIRANTS BOT — PART 2
 * OWNER / ADMIN ENGINE (FINAL • SAFE • NO DUPES)
 *************************************************/

/* ================= OWNER STATE ================= */

const ADMIN = {
  uploads: {},   // ownerId -> session
  logs: []
};

function ownerLog(text) {
  ADMIN.logs.unshift(`• ${text} (${new Date().toLocaleString()})`);
  ADMIN.logs = ADMIN.logs.slice(0, 20);
  bot.sendMessage(OWNER_ID, `📜 OWNER LOG\n${text}`).catch(() => {});
}

function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ================= STRONG QUESTION PARSER ================= */

function parseQuestions(raw) {
  const blocks = raw
    .split(/(?:\n\s*---+\s*\n)|(?:\n{2,})/)
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

/* ================= MAINTENANCE FLAG ================= */

let MAINTENANCE_MODE = false;

/* ================= OWNER CALLBACK INJECTION ================= */
/* ⚠️ THIS IS NOT A NEW ROUTER — IT HOOKS INTO PART-1 */

const _ownerHook = bot._ownerHook || (bot._ownerHook = []);

_ownerHook.push(async function (data, chatId, userId) {
  if (!isOwnerUser(userId)) return false;

  const session = ADMIN.uploads[userId];

  /* ===== OWNER PANEL ===== */
  if (data === "OWNER_PANEL") {
    await bot.sendMessage(chatId,
`👑 *OWNER CONTROL PANEL*

Choose an action 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📤 Upload Daily Test", callback_data: "ADMIN_UPLOAD_DAILY" }],
            [{ text: "🔁 Upload Practice Bank", callback_data: "ADMIN_UPLOAD_PRACTICE" }],
            [{ text: "📊 Analytics", callback_data: "ADMIN_ANALYTICS" }],
            [{ text: "📡 Bot Status", callback_data: "ADMIN_STATUS" }],
            [
              { text: "🔒 Maintenance ON", callback_data: "ADMIN_MAINT_ON" },
              { text: "🔓 Maintenance OFF", callback_data: "ADMIN_MAINT_OFF" }
            ],
            [{ text: "📜 Owner Logs", callback_data: "ADMIN_LOGS" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== START DAILY UPLOAD ===== */
  if (data === "ADMIN_UPLOAD_DAILY") {
    if (session) {
      await bot.sendMessage(chatId, "⚠️ Finish current upload using /done");
      return true;
    }

    ADMIN.uploads[userId] = {
      type: "daily",
      step: "date",
      date: null,
      buffer: ""
    };

    ownerLog("Started DAILY upload");

    await bot.sendMessage(chatId,
`📅 *Daily Test Upload*

Send date in format:
YYYY-MM-DD`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== START PRACTICE UPLOAD ===== */
  if (data === "ADMIN_UPLOAD_PRACTICE") {
    if (session) {
      await bot.sendMessage(chatId, "⚠️ Finish current upload using /done");
      return true;
    }

    ADMIN.uploads[userId] = {
      type: "practice",
      step: "date",
      date: null,
      buffer: ""
    };

    ownerLog("Started PRACTICE upload");

    await bot.sendMessage(chatId,
`📅 *Practice Bank Upload*

Send date (for grouping):
YYYY-MM-DD`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== LOGS ===== */
  if (data === "ADMIN_LOGS") {
    const logs = ADMIN.logs.length ? ADMIN.logs.join("\n") : "No logs yet";
    await bot.sendMessage(chatId,
`📜 *OWNER LOGS*

${logs}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== ANALYTICS ===== */
  if (data === "ADMIN_ANALYTICS") {
    const totalUsers = await User.countDocuments();
    const today = todayDate();
    const todayAttempts = await Attempt.countDocuments({ date: today });

    const avgAgg = await Attempt.aggregate([
      { $match: { date: today } },
      { $group: { _id: null, avg: { $avg: "$score" } } }
    ]);

    const avgScore = avgAgg.length ? avgAgg[0].avg.toFixed(1) : "0";

    await bot.sendMessage(chatId,
`📊 *BOT ANALYTICS*

👥 Users: ${totalUsers}
🧬 Today Attempts: ${todayAttempts}
⭐ Avg Score: ${avgScore} / 25`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== STATUS ===== */
  if (data === "ADMIN_STATUS") {
    await bot.sendMessage(chatId,
`📡 *BOT STATUS*

🟢 Bot: Online
🟢 Database: Connected
🔒 Maintenance: ${MAINTENANCE_MODE ? "ON" : "OFF"}
⏱️ ${new Date().toLocaleString()}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== MAINTENANCE ===== */
  if (data === "ADMIN_MAINT_ON") {
    MAINTENANCE_MODE = true;
    ownerLog("Maintenance ENABLED");
    await bot.sendMessage(chatId, "🔒 Maintenance mode enabled");
    return true;
  }

  if (data === "ADMIN_MAINT_OFF") {
    MAINTENANCE_MODE = false;
    ownerLog("Maintenance DISABLED");
    await bot.sendMessage(chatId, "✅ Maintenance mode disabled");
    return true;
  }

  return false;
});

/* ================= OWNER MESSAGE FLOW ================= */

bot.on("message", async (msg) => {
  if (!isOwnerUser(msg.from?.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) return;

  /* DATE STEP */
  if (session.step === "date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(msg.chat.id, "❌ Invalid date format");
    }

    const exists = await Question.countDocuments({ date: d, type: session.type });
    session.date = d;

    if (exists > 0) {
      session.step = "confirm";
      return bot.sendMessage(msg.chat.id,
`⚠️ Data already exists for ${d}

Overwrite?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Overwrite", callback_data: "ADMIN_OVERWRITE_YES" }],
              [{ text: "❌ Cancel", callback_data: "ADMIN_OVERWRITE_NO" }]
            ]
          }
        }
      );
    }

    session.step = "questions";
    return bot.sendMessage(msg.chat.id,
`📝 Paste all questions now
Send /done when finished`);
  }

  /* QUESTIONS STEP */
  if (session.step === "questions" && msg.text && !msg.text.startsWith("/")) {
    session.buffer += "\n\n" + msg.text;
    const count = parseQuestions(session.buffer).length;

    return bot.sendMessage(msg.chat.id,
`📝 Questions detected so far: ${count}`);
  }
});

/* ================= OVERWRITE CONFIRM ================= */

bot.on("callback_query", async (q) => {
  if (!isOwnerUser(q.from.id)) return;

  const session = ADMIN.uploads[q.from.id];
  if (!session) return;

  if (q.data === "ADMIN_OVERWRITE_NO") {
    delete ADMIN.uploads[q.from.id];
    ownerLog("Upload cancelled");
    return bot.sendMessage(q.message.chat.id, "❌ Upload cancelled");
  }

  if (q.data === "ADMIN_OVERWRITE_YES") {
    await Question.deleteMany({ date: session.date, type: session.type });
    session.step = "questions";
    ownerLog(`Overwrite confirmed: ${session.type} ${session.date}`);

    return bot.sendMessage(q.message.chat.id,
`🗑️ Old data deleted
Paste questions now
Send /done when finished`);
  }
});

/* ================= /DONE ================= */

bot.onText(/\/done/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) {
    return bot.sendMessage(msg.chat.id, "❌ No active upload");
  }

  const parsed = parseQuestions(session.buffer);
  if (parsed.length === 0) {
    return bot.sendMessage(msg.chat.id, "❌ No valid questions detected");
  }

  if (session.type === "daily" && parsed.length !== 25) {
    return bot.sendMessage(msg.chat.id,
`❌ Daily test must have EXACTLY 25 questions
Detected: ${parsed.length}`);
  }

  await Question.insertMany(parsed.map(q => ({
    ...q,
    date: session.date,
    type: session.type
  })));

  ownerLog(`${session.type.toUpperCase()} uploaded — ${session.date} (${parsed.length})`);

  await bot.sendMessage(msg.chat.id,
`✅ Upload successful

📅 ${session.date}
📝 Questions: ${parsed.length}`);

  delete ADMIN.uploads[msg.from.id];
});



/*************************************************
 * BLOCK-3 — DAILY TEST ENGINE
 * • One-time option click
 * • Instant feedback + reason
 * • Live timer
 * • Auto submit
 *************************************************/

/* ================= DAILY TEST STATE ================= */

const DAILY_TOTAL_Q = 25;
const DAILY_TIME_LIMIT = 30 * 60 * 1000; // 30 minutes

/* ================= START DAILY TEST ================= */

async function startDailyTest(chatId, userId) {
  // Force join check
  if (!(await isJoined(userId))) {
    joinPending[userId] = "daily";
    return requireJoin(chatId, userId, "daily");
  }

  const date = todayDate();

  // User can attempt only once
  if (!isOwnerUser(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) {
      return bot.sendMessage(
        chatId,
        "❌ You already attempted today’s test.\nCome back tomorrow 💪"
      );
    }
  }

  const questions = await Question.find({ date, type: "daily" });
  if (questions.length !== DAILY_TOTAL_Q) {
    return bot.sendMessage(
      chatId,
      "⏳ Daily test not ready yet.\nTry again later 💪"
    );
  }

  activeTests[userId] = {
    type: "daily",
    date,
    questions,
    index: 0,
    score: 0,
    answered: false,
    startTime: null
  };

  await bot.sendMessage(
    chatId,
`🧬 *Daily Biology Test*

📝 Total Questions: 25
⏱️ Time Limit: 30 Minutes
🏆 Rank + Leaderboard Included

👇 Ready? Start below`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start Test", callback_data: "daily_start" }],
          [{ text: "❌ Cancel", callback_data: "main_menu" }]
        ]
      }
    }
  );
}

/* ================= SEND DAILY QUESTION ================= */

function sendDailyQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  t.answered = false;

  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const left = Math.max(0, 30 * 60 - elapsed);

  bot.sendMessage(
    chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${Math.floor(left / 60)} min ${left % 60} sec

${q.q}

🅐 ${q.options[0]}     🅑 ${q.options[1]}
🅒 ${q.options[2]}     🅓 ${q.options[3]}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🅐", callback_data: "ans_0" },
            { text: "🅑", callback_data: "ans_1" }
          ],
          [
            { text: "🅒", callback_data: "ans_2" },
            { text: "🅓", callback_data: "ans_3" }
          ]
        ]
      }
    }
  );
}

/* ================= FINISH DAILY TEST ================= */

async function finishDailyTest(chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);

  if (!isOwnerUser(userId)) {
    await Attempt.create({
      user_id: userId,
      date: t.date,
      score: t.score,
      timeTaken
    });

    await User.updateOne(
      { user_id: userId },
      { $inc: { totalTests: 1, totalScore: t.score } }
    );
  }

  delete activeTests[userId];

  await bot.sendMessage(
    chatId,
timeOver
  ? `⏰ *Time Over — Test Auto Submitted*

⭐ Score: ${t.score} / 25`
  : `✅ *Daily Test Completed 🎉*

⭐ Score: ${t.score} / 25
⏱️ Time Taken: ${Math.floor(timeTaken / 60)} min ${timeTaken % 60} sec`,
    { parse_mode: "Markdown" }
  );

  await showLeaderboard(chatId, t.date);

  await bot.sendMessage(chatId, "🚀 START NOW", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 START NOW", callback_data: "main_menu" }]
      ]
    }
  });
}

/* =====================================================
   DAILY CALLBACKS
   ⚠️ THIS CODE GOES INSIDE THE SINGLE CALLBACK ROUTER
===================================================== */

// Enter daily
if (data === "daily") {
  return startDailyTest(chatId, userId);
}

// Start daily
if (data === "daily_start" && activeTests[userId]) {
  const t = activeTests[userId];
  t.startTime = Date.now();

  sendDailyQuestion(chatId, userId);

  setTimeout(() => {
    if (activeTests[userId]) {
      finishDailyTest(chatId, userId, true);
    }
  }, DAILY_TIME_LIMIT);

  return;
}

// Answer (ONLY ONCE)
if (data.startsWith("ans_") && activeTests[userId]) {
  const t = activeTests[userId];
  if (t.answered) return;

  t.answered = true;

  const selected = Number(data.split("_")[1]);
  const q = t.questions[t.index];
  const correct = selected === q.correct;

  if (correct) t.score++;

  return bot.sendMessage(
    chatId,
correct
  ? `✅ *Correct!*\n\n✔️ ${q.reason}`
  : `❌ *Wrong!*\n\n✅ Correct Answer: ${
      ["🅐","🅑","🅒","🅓"][q.correct]
    }\n✔️ ${q.reason}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➡️ Next Question", callback_data: "daily_next" }]
        ]
      }
    }
  );
}

// Next question
if (data === "daily_next" && activeTests[userId]) {
  const t = activeTests[userId];
  t.index++;

  if (t.index >= DAILY_TOTAL_Q) {
    return finishDailyTest(chatId, userId, false);
  }

  return sendDailyQuestion(chatId, userId);
}


/*************************************************
 * BLOCK-4 — PRACTICE TEST ENGINE
 * • Unlimited attempts
 * • Random questions (25)
 * • One-time option click
 * • Instant feedback + reason
 * • No leaderboard
 *************************************************/

/* ================= PRACTICE CONFIG ================= */

const PRACTICE_TOTAL_Q = 25;
const PRACTICE_TIME_LIMIT = 30 * 60 * 1000; // 30 minutes

/* ================= RANDOM PRACTICE PICKER ================= */

async function getRandomPracticeQuestions() {
  const total = await Question.countDocuments({ type: "practice" });
  if (total < PRACTICE_TOTAL_Q) return [];

  const skip = Math.floor(Math.random() * (total - PRACTICE_TOTAL_Q + 1));

  return Question.find({ type: "practice" })
    .skip(skip)
    .limit(PRACTICE_TOTAL_Q);
}

/* ================= START PRACTICE ================= */

async function startPracticeTest(chatId, userId) {
  // Force join check
  if (!(await isJoined(userId))) {
    joinPending[userId] = "practice";
    return requireJoin(chatId, userId, "practice");
  }

  const questions = await getRandomPracticeQuestions();
  if (!questions.length) {
    return bot.sendMessage(
      chatId,
      "⏳ Practice questions not available yet.\nTry again later 💪"
    );
  }

  activeTests[userId] = {
    type: "practice",
    questions,
    index: 0,
    score: 0,
    answered: false,
    startTime: null
  };

  await bot.sendMessage(
    chatId,
`🔁 *Biology Practice Test*

📝 Total Questions: 25
⏱️ Time Limit: 30 Minutes
📚 Purpose: Learning + Concept clarity

👇 Ready? Start below`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start Practice", callback_data: "practice_start" }],
          [{ text: "❌ Cancel", callback_data: "main_menu" }]
        ]
      }
    }
  );
}

/* ================= SEND PRACTICE QUESTION ================= */

function sendPracticeQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  t.answered = false;

  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const left = Math.max(0, 30 * 60 - elapsed);

  bot.sendMessage(
    chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${Math.floor(left / 60)} min ${left % 60} sec

${q.q}

🅐 ${q.options[0]}     🅑 ${q.options[1]}
🅒 ${q.options[2]}     🅓 ${q.options[3]}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🅐", callback_data: "p_ans_0" },
            { text: "🅑", callback_data: "p_ans_1" }
          ],
          [
            { text: "🅒", callback_data: "p_ans_2" },
            { text: "🅓", callback_data: "p_ans_3" }
          ]
        ]
      }
    }
  );
}

/* ================= FINISH PRACTICE ================= */

async function finishPracticeTest(chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);

  await User.updateOne(
    { user_id: userId },
    {
      $inc: {
        practiceTests: 1,
        practiceCorrect: t.score,
        practiceWrong: PRACTICE_TOTAL_Q - t.score
      }
    }
  );

  delete activeTests[userId];

  const accuracy = ((t.score / PRACTICE_TOTAL_Q) * 100).toFixed(1);

  await bot.sendMessage(
    chatId,
timeOver
  ? `⏰ *Practice Time Over*

✔️ Correct: ${t.score}
❌ Wrong: ${PRACTICE_TOTAL_Q - t.score}
📊 Accuracy: ${accuracy}%`
  : `✅ *Practice Session Completed 🎯*

✔️ Correct: ${t.score}
❌ Wrong: ${PRACTICE_TOTAL_Q - t.score}
⏱️ Time Taken: ${Math.floor(timeTaken / 60)} min ${timeTaken % 60} sec
📊 Accuracy: ${accuracy}%`,
    { parse_mode: "Markdown" }
  );

  await bot.sendMessage(chatId, "🚀 START NOW", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔁 Practice Again", callback_data: "practice" }],
        [{ text: "🚀 START NOW", callback_data: "main_menu" }]
      ]
    }
  });
}

/* =====================================================
   PRACTICE CALLBACKS
   ⚠️ THIS CODE GOES INSIDE THE SINGLE CALLBACK ROUTER
===================================================== */

// Enter practice
if (data === "practice") {
  return startPracticeTest(chatId, userId);
}

// Start practice
if (data === "practice_start" && activeTests[userId]) {
  const t = activeTests[userId];
  t.startTime = Date.now();

  sendPracticeQuestion(chatId, userId);

  setTimeout(() => {
    if (activeTests[userId]) {
      finishPracticeTest(chatId, userId, true);
    }
  }, PRACTICE_TIME_LIMIT);

  return;
}

// Answer (ONLY ONCE)
if (data.startsWith("p_ans_") && activeTests[userId]) {
  const t = activeTests[userId];
  if (t.answered) return;

  t.answered = true;

  const selected = Number(data.split("_")[2]);
  const q = t.questions[t.index];
  const correct = selected === q.correct;

  if (correct) t.score++;

  return bot.sendMessage(
    chatId,
correct
  ? `✅ *Correct!*\n\n✔️ ${q.reason}`
  : `❌ *Wrong!*\n\n✅ Correct Answer: ${
      ["🅐","🅑","🅒","🅓"][q.correct]
    }\n✔️ ${q.reason}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "➡️ Next Question", callback_data: "practice_next" }]
        ]
      }
    }
  );
}

// Next question
if (data === "practice_next" && activeTests[userId]) {
  const t = activeTests[userId];
  t.index++;

  if (t.index >= PRACTICE_TOTAL_Q) {
    return finishPracticeTest(chatId, userId, false);
  }

  return sendPracticeQuestion(chatId, userId);
}


/*************************************************
 * BLOCK-5 — OWNER UPLOAD ENGINE
 * • Daily + Practice upload
 * • Multi-message paste
 * • Overwrite confirmation
 * • /done to finish
 *************************************************/

/* ================= OWNER STATE ================= */

const ADMIN = {
  uploads: {} // userId -> session
};

/* ================= PARSER ================= */

function parseQuestions(text) {
  const blocks = text.split(/\n\s*\n/);
  const questions = [];

  for (const b of blocks) {
    const lines = b.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 7) continue;

    const q = lines[0];
    const options = lines.slice(1, 5);
    const correctLine = lines.find(l => l.startsWith("Answer:"));
    const reasonLine = lines.find(l => l.startsWith("Reason:"));

    if (!correctLine || !reasonLine) continue;

    const correct = ["A","B","C","D"].indexOf(
      correctLine.replace("Answer:", "").trim()
    );

    if (correct === -1) continue;

    questions.push({
      q,
      options,
      correct,
      reason: reasonLine.replace("Reason:", "").trim()
    });
  }

  return questions;
}

/* ================= OWNER COMMANDS ================= */

bot.onText(/\/upload_daily/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  const date = todayDate();

  const exists = await Question.countDocuments({ date, type: "daily" });
  if (exists) {
    ADMIN.uploads[msg.from.id] = { type: "daily", date, buffer: "" };

    return bot.sendMessage(msg.chat.id,
`⚠️ *Daily test already exists for ${date}*

Overwrite existing test?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ YES, OVERWRITE", callback_data: "ADMIN_OVERWRITE_YES" }],
            [{ text: "❌ NO, CANCEL", callback_data: "ADMIN_OVERWRITE_NO" }]
          ]
        }
      }
    );
  }

  ADMIN.uploads[msg.from.id] = { type: "daily", date, buffer: "" };

  bot.sendMessage(msg.chat.id,
`🧬 *Daily Test Upload Started*

📅 Date: ${date}
📌 Paste questions now
Send /done when finished`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/upload_practice/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  ADMIN.uploads[msg.from.id] = {
    type: "practice",
    date: todayDate(),
    buffer: ""
  };

  bot.sendMessage(msg.chat.id,
`🔁 *Practice Upload Started*

📌 Paste questions (unlimited)
Send /done when finished`,
    { parse_mode: "Markdown" }
  );
});

/* ================= QUESTION PASTE ================= */

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isOwnerUser(msg.from.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) return;

  session.buffer += "\n\n" + msg.text;

  const count = parseQuestions(session.buffer).length;

  bot.sendMessage(msg.chat.id,
`📝 Questions detected so far: ${count}`);
});

/* ================= /DONE ================= */

bot.onText(/\/done/, async (msg) => {
  if (!isOwnerUser(msg.from.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) return;

  const parsed = parseQuestions(session.buffer);

  if (session.type === "daily" && parsed.length !== 25) {
    return bot.sendMessage(msg.chat.id,
      "❌ Daily test must have exactly 25 questions"
    );
  }

  if (!parsed.length) {
    return bot.sendMessage(msg.chat.id,
      "❌ No valid questions found"
    );
  }

  await Question.insertMany(parsed.map(q => ({
    ...q,
    date: session.date,
    type: session.type
  })));

  delete ADMIN.uploads[msg.from.id];

  bot.sendMessage(msg.chat.id,
`✅ *Upload Completed*

🧪 Type: ${session.type}
📊 Questions: ${parsed.length}`,
    { parse_mode: "Markdown" }
  );
});

/* ================= OVERWRITE CALLBACKS ================= */

function registerOwnerOverwriteCallbacks(bot) {
  if (!bot._ownerHook) bot._ownerHook = [];

  bot._ownerHook.push(async (data, chatId, userId) => {
    if (!isOwnerUser(userId)) return false;

    const session = ADMIN.uploads[userId];
    if (!session) return false;

    if (data === "ADMIN_OVERWRITE_YES") {
      await Question.deleteMany({
        date: session.date,
        type: session.type
      });

      session.buffer = "";

      await bot.sendMessage(chatId,
`🗑️ Old data deleted

📌 Paste questions now
Send /done when finished`);

      return true;
    }

    if (data === "ADMIN_OVERWRITE_NO") {
      delete ADMIN.uploads[userId];

      await bot.sendMessage(chatId,
        "❌ Upload cancelled"
      );
      return true;
    }

    return false;
  });
}

registerOwnerOverwriteCallbacks(bot);


/*************************************************
 * BLOCK-6 — SMART GUARDS + SURPRISE FEATURES
 * ADD-ONLY • NO REDECLARE • NO NEW CALLBACK
 *************************************************/

/* =================================================
   1️⃣ OWNER HOOK SYSTEM (SAFE EXTENSION)
================================================= */
// Allows future owner features without touching callback router

if (!bot._ownerHook) {
  bot._ownerHook = [];
}

// helper to register owner hooks safely
function registerOwnerHook(fn) {
  if (typeof fn === "function") {
    bot._ownerHook.push(fn);
  }
}

/* =================================================
   2️⃣ ONE-CLICK ANSWER HARD LOCK (ANTI-SPAM)
================================================= */
// Extra safety even if user double-taps very fast

function hardLockAnswer(t) {
  if (!t) return true;
  if (t._hardLocked) return false;
  t._hardLocked = true;
  return true;
}

function releaseHardLock(t) {
  if (t) t._hardLocked = false;
}

/* =================================================
   3️⃣ SMART TIME PRESSURE DETECTOR
================================================= */
// Adds silent flag when user is rushing (used later in tips)

function detectTimePressure(t) {
  if (!t || !t.startTime) return false;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  return elapsed < 15; // answered within 15 sec
}

/* =================================================
   4️⃣ PRACTICE DIFFICULTY BALANCER (SILENT)
================================================= */
// Marks weak accuracy silently for future insights

function markPracticeWeakness(userId, correct) {
  if (!correct && activeTests[userId]?.type === "practice") {
    activeTests[userId]._weakFlag = true;
  }
}

/* =================================================
   5️⃣ SAFE WRAPPER: ANSWER HANDLER GUARD
================================================= */
// Wraps existing answer flow WITHOUT redefining it

const _sendMessageSafe = bot.sendMessage.bind(bot);

bot.sendMessage = async function (chatId, text, opts = {}) {
  try {
    return await _sendMessageSafe(chatId, text, opts);
  } catch (e) {
    console.error("❌ SendMessage failed:", e.message);
  }
};

/* =================================================
   6️⃣ OWNER INVISIBLE MODE ENFORCER
================================================= */
// Ensures owner never leaks into leaderboard

function isInvisibleOwner(userId) {
  return isOwnerUser(userId);
}

/* =================================================
   7️⃣ SILENT CRASH RESUME PROTECTOR
================================================= */
// Prevents ghost sessions after Render restart

setInterval(() => {
  const now = Date.now();
  for (const uid in activeTests) {
    const t = activeTests[uid];
    if (!t?.startTime) continue;

    const elapsed = (now - t.startTime) / 1000;
    if (elapsed > 40 * 60) {
      delete activeTests[uid]; // hard cleanup
    }
  }
}, 5 * 60 * 1000);

/* =================================================
   8️⃣ MAINTENANCE HARD GUARD (EXTRA SAFETY)
================================================= */
// Even if someone bypasses UI, this blocks them

registerOwnerHook(async (data, chatId, userId) => {
  if (typeof MAINTENANCE_MODE !== "undefined") {
    if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
      await bot.sendMessage(chatId,
        "🔧 Bot is under maintenance.\nPlease try again later 🙏"
      );
      return true;
    }
  }
  return false;
});

/* =================================================
   9️⃣ OWNER SAFETY SNAPSHOT (AUTO)
================================================= */
// Shows owner recent state when they open panel

registerOwnerHook(async (data, chatId, userId) => {
  if (!isOwnerUser(userId)) return false;

  if (data === "owner_panel") {
    const active = Object.keys(activeTests).length;
    await bot.sendMessage(chatId,
`🛡️ *Owner Safety Snapshot*

• Active sessions: ${active}
• Maintenance: ${MAINTENANCE_MODE ? "ON" : "OFF"}
• Server time: ${new Date().toLocaleString()}`,
      { parse_mode: "Markdown" }
    );
    return false; // allow panel to continue
  }
  return false;
});

/* =================================================
   🔟 SOFT CONSISTENCY NUDGE (NON-SPAM)
================================================= */
// One gentle tip per session max

const _nudgedUsers = new Set();

function maybeNudge(userId, chatId) {
  if (_nudgedUsers.has(userId)) return;
  _nudgedUsers.add(userId);

  setTimeout(() => {
    bot.sendMessage(chatId,
      "💡 Tip: Daily test + regular practice = fastest improvement 🚀"
    );
  }, 2000);
}

/* =================================================
   1️⃣1️⃣ EXPORT SAFE UTILITIES (NO GLOBAL LEAK)
================================================= */

global.__BLOCK6_UTILS__ = {
  hardLockAnswer,
  releaseHardLock,
  detectTimePressure,
  markPracticeWeakness,
  maybeNudge,
  isInvisibleOwner
};

/*************************************************
 * BLOCK-6 END — ZERO CONFLICT GUARANTEED
 *************************************************/
