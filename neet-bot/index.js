/*************************************************
 * NEET ASPIRANTS BOT — PART 1 (FINAL)
 * CORE USER ENGINE
 * Stable • Score-Safe • UX Polished
 *************************************************/

require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");

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
  .catch(err => console.error("❌ Mongo error", err));

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
  console.log("🚀 Bot running via webhook");
});

/* ================= HELPERS ================= */

const todayDate = () => new Date().toISOString().split("T")[0];
const isOwner = id => id === OWNER_ID;

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

/* ================= STATE ================= */

// activeTests[userId] = {
//   type, date, questions, index,
//   score, startTime, answered
// }

const activeTests = {};
const joinPending = {};

/* ================= /START ================= */

bot.onText(/\/start/, async msg => {
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

  const welcome = `
👋 *Welcome to NEET Aspirants Bot* 🧬

🎯 Serious NEET Biology practice
🧪 Daily Test + 🔁 Practice
🏆 Rank + Leaderboard
📊 Smart Progress Tracking

👇 Start below
`;

  await bot.sendMessage(chatId, welcome, { parse_mode: "Markdown" });
  await showLeaderboard(chatId, todayDate());
});

/* ================= FORCE JOIN ================= */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;

  await bot.sendMessage(chatId,
`🔒 *Join Required*

Please join our official channel first.`,
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
    { $sort: { score: -1, timeTaken: 1 } },
    { $limit: 10 }
  ]);

  let text = `🏆 *Daily Biology Leaderboard*\n📅 ${date}\n\n`;

  if (!rows.length) {
    text += "No attempts yet.\nBe the first 💪";
  } else {
    rows.forEach((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
      text += `${medal} User ${r._id}\n⭐ ${r.score}/25 | ⏱️ ${r.timeTaken}s\n\n`;
    });
  }

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Start Now", callback_data: "start_menu" }]
      ]
    }
  });
}

/* ================= TEST ENGINE ================= */

function remainingTime(t) {
  const total = 30 * 60;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const left = Math.max(total - elapsed, 0);
  return `${Math.floor(left / 60)}m ${left % 60}s`;
}

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) return requireJoin(chatId, userId, type);

  const date = todayDate();

  if (type === "daily" && !isOwner(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) {
      return bot.sendMessage(chatId,
        "❌ You already attempted today’s test.\nCome back tomorrow 💪"
      );
    }
  }

  const qs = await Question.find({ date, type });
  if (qs.length < 1) {
    return bot.sendMessage(chatId,
      "⏳ Test not available yet.\nTry Practice 💪"
    );
  }

  activeTests[userId] = {
    type,
    date,
    questions: qs.slice(0, 25),
    index: 0,
    score: 0,
    startTime: null,
    answered: false
  };

  await bot.sendMessage(chatId,
    `🧬 *${type === "daily" ? "Daily Test" : "Practice Test"}*\n📝 25 Questions | ⏱️ 30 Minutes`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start", callback_data: "start_now" }]
        ]
      }
    }
  );
}

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  t.answered = false;

  const text =
`🧬 *Question ${t.index + 1}/25*
⏱️ *Time Left:* ${remainingTime(t)}

${q.q}

🅐 ${q.options[0]}
🅑 ${q.options[1]}
🅒 ${q.options[2]}
🅓 ${q.options[3]}`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🅐", callback_data: "ans_0" }, { text: "🅑", callback_data: "ans_1" }],
        [{ text: "🅒", callback_data: "ans_2" }, { text: "🅓", callback_data: "ans_3" }]
      ]
    }
  });
}

/* ================= CALLBACK HANDLER ================= */

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const t = activeTests[userId];

  if (q.data === "start_menu") {
    return bot.sendMessage(chatId, "Choose option 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧬 Daily Test", callback_data: "daily_test" }],
          [{ text: "🔁 Practice", callback_data: "practice_test" }],
          [{ text: "📊 Progress", callback_data: "progress" }],
          [{ text: "☎️ Contact", url: SUPPORT_BOT_URL }]
        ]
      }
    });
  }

  if (q.data === "daily_test") return startTest(chatId, userId, "daily");
  if (q.data === "practice_test") return startTest(chatId, userId, "practice");

  if (q.data === "start_now") {
    if (!t) return;
    t.startTime = Date.now();
    sendQuestion(chatId, userId);

    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId);
    }, 30 * 60 * 1000);
  }

  if (q.data.startsWith("ans_")) {
    if (!t || t.answered) return; // 🔒 MULTI-CLICK FIX
    t.answered = true;

    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];

    const correct = sel === cq.correct;
    if (correct) t.score++;

    await bot.sendMessage(chatId,
      correct
        ? `✅ *Correct!*\n${cq.reason}`
        : `❌ *Wrong!*\n✅ Correct: ${["A","B","C","D"][cq.correct]}\n${cq.reason}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➡️ Next", callback_data: "next_q" }]
          ]
        }
      }
    );
  }

  if (q.data === "next_q") {
    if (!t) return;
    t.index++;
    if (t.index >= t.questions.length) return finishTest(chatId, userId);
    sendQuestion(chatId, userId);
  }
});

/* ================= FINISH TEST ================= */

async function finishTest(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);

  if (t.type === "daily") {
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

  if (t.type === "practice") {
    await User.updateOne(
      { user_id: userId },
      {
        $inc: {
          practiceTests: 1,
          practiceCorrect: t.score,
          practiceWrong: 25 - t.score
        }
      }
    );
  }

  delete activeTests[userId];

  await bot.sendMessage(chatId,
    `✅ *Test Completed*\n⭐ Score: ${t.score}/25\n⏱️ Time: ${timeTaken}s`,
    { parse_mode: "Markdown" }
  );
}

/* ================= PROGRESS ================= */

async function showProgress(chatId, userId) {
  const u = await User.findOne({ user_id: userId });
  if (!u) return;

  await bot.sendMessage(chatId,
`📊 *My Progress*

🧬 Tests: ${u.totalTests}
⭐ Score: ${u.totalScore}

🔁 Practice Correct: ${u.practiceCorrect}
❌ Wrong: ${u.practiceWrong}`,
    { parse_mode: "Markdown" }
  );
}

/* ================= MIDNIGHT CRON ================= */

cron.schedule("0 0 * * *", async () => {
  const users = await User.find({});
  for (const u of users) {
    bot.sendMessage(u.user_id,
      "🧬 New Biology Test is LIVE!"
    ).catch(()=>{});
  }
});
/*************************************************
 * NEET ASPIRANTS BOT — PART 2 (FINAL)
 * OWNER / ADMIN UPLOAD MODULE
 * ADD-ONLY (DO NOT MODIFY PART-1)
 *************************************************/

/* ================= OWNER HELPERS ================= */

function isOwner(msg) {
  return msg.from && msg.from.id === OWNER_ID;
}

function notifyOwner(text) {
  bot.sendMessage(OWNER_ID, text).catch(() => {});
}

/* ================= UPLOAD STATE ================= */

// uploadSessions[OWNER_ID] = {
//   type: "daily" | "practice",
//   date: "YYYY-MM-DD",
//   buffer: "",
//   step: "date" | "questions"
// }

const uploadSessions = {};

/* ================= STRONG PARSER ================= */
/*
  ✔ Detects questions by Q<number>
  ✔ Ignores spacing issues
  ✔ No dependency on ---
*/

function parseQuestions(raw) {
  const blocks = raw
    .split(/(?=Q\d+\.)/g)   // split BEFORE Q1., Q2., etc
    .map(b => b.trim())
    .filter(Boolean);

  const questions = [];

  for (const block of blocks) {
    const qMatch = block.match(/Q\d+\.\s*(.+)/i);
    const options = [...block.matchAll(/^[A-D]\)\s*(.+)$/gmi)];
    const ansMatch = block.match(/Ans:\s*([A-D])/i);
    const reasonMatch = block.match(/Reason:\s*(.+)/i);

    if (!qMatch) continue;
    if (options.length !== 4) continue;
    if (!ansMatch) continue;

    const correctIndex = ["A","B","C","D"]
      .indexOf(ansMatch[1].toUpperCase());

    if (correctIndex === -1) continue;

    questions.push({
      q: qMatch[1].trim(),
      options: options.map(o => o[1].trim()),
      correct: correctIndex,
      reason: reasonMatch
        ? reasonMatch[1].trim()
        : "Explanation not provided"
    });
  }

  return questions;
}

/* ================= START DAILY UPLOAD ================= */

bot.onText(/\/upload_daily/, async msg => {
  if (!isOwner(msg)) return;

  uploadSessions[OWNER_ID] = {
    type: "daily",
    date: null,
    buffer: "",
    step: "date"
  };

  await bot.sendMessage(msg.chat.id,
`📅 *Daily Test Upload*

Send date in format:
YYYY-MM-DD`,
    { parse_mode: "Markdown" }
  );

  notifyOwner("🟡 Daily upload started — waiting for date");
});

/* ================= START PRACTICE UPLOAD ================= */

bot.onText(/\/upload_practice/, async msg => {
  if (!isOwner(msg)) return;

  uploadSessions[OWNER_ID] = {
    type: "practice",
    date: null,
    buffer: "",
    step: "date"
  };

  await bot.sendMessage(msg.chat.id,
`📅 *Practice Upload*

Send date in format:
YYYY-MM-DD`,
    { parse_mode: "Markdown" }
  );

  notifyOwner("🟡 Practice upload started — waiting for date");
});

/* ================= CANCEL UPLOAD ================= */

bot.onText(/\/cancel_upload/, async msg => {
  if (!isOwner(msg)) return;

  delete uploadSessions[OWNER_ID];
  await bot.sendMessage(msg.chat.id, "❌ Upload cancelled.");
  notifyOwner("⚠️ Upload cancelled by owner");
});

/* ================= OWNER MESSAGE HANDLER ================= */

bot.on("message", async msg => {
  if (!isOwner(msg)) return;

  const session = uploadSessions[OWNER_ID];
  if (!session) return;

  // STEP 1 — DATE
  if (session.step === "date") {
    const date = msg.text?.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return bot.sendMessage(msg.chat.id,
        "❌ Invalid date format.\nUse YYYY-MM-DD");
    }

    const exists = await Question.countDocuments({
      date,
      type: session.type
    });

    if (exists > 0) {
      await bot.sendMessage(msg.chat.id,
`⚠️ ${session.type.toUpperCase()} already exists for ${date}
Old questions will be replaced.`);
    }

    await Question.deleteMany({ date, type: session.type });

    session.date = date;
    session.step = "questions";

    await bot.sendMessage(msg.chat.id,
`✅ Date set: ${date}

📌 Now paste questions
(25 MCQs — one message or multiple)

When finished send:
/done`);

    notifyOwner(`📅 Upload date set: ${date}`);
    return;
  }

  // STEP 2 — COLLECT QUESTIONS
  if (session.step === "questions") {
    if (!msg.text || msg.text.startsWith("/")) return;

    session.buffer += "\n" + msg.text;

    const parsed = parseQuestions(session.buffer);

    if (parsed.length === 0) {
      return bot.sendMessage(msg.chat.id,
        "⚠️ No valid questions detected yet.\nContinue pasting…");
    }

    await bot.sendMessage(msg.chat.id,
      `📝 Detected questions so far: ${parsed.length}`);
  }
});

/* ================= DONE COMMAND ================= */

bot.onText(/\/done/, async msg => {
  if (!isOwner(msg)) return;

  const session = uploadSessions[OWNER_ID];
  if (!session || !session.date) {
    return bot.sendMessage(msg.chat.id,
      "❌ No active upload session.");
  }

  const parsed = parseQuestions(session.buffer);

  if (parsed.length === 0) {
    return bot.sendMessage(msg.chat.id,
      "❌ No valid questions found.\nUpload failed.");
  }

  await Question.insertMany(
    parsed.map(q => ({
      ...q,
      date: session.date,
      type: session.type
    }))
  );

  await bot.sendMessage(msg.chat.id,
`✅ *Upload Successful*

📅 Date: ${session.date}
📝 Questions saved: ${parsed.length}`,
    { parse_mode: "Markdown" }
  );

  notifyOwner(
`✅ ${session.type.toUpperCase()} upload completed
📅 ${session.date}
📝 ${parsed.length} questions saved`
  );

  delete uploadSessions[OWNER_ID];
});
/*************************************************
 * NEET ASPIRANTS BOT — PART 3
 * ADMIN VIEW / DELETE / EDIT / ANALYTICS
 * ADD-ONLY MODULE (SAFE)
 *************************************************/

/* ===============================================
   OWNER GUARD
================================================ */

function ownerOnly(msg) {
  return msg.from && msg.from.id === OWNER_ID;
}

async function ownerLog(text) {
  await bot.sendMessage(
    OWNER_ID,
    `📜 *OWNER LOG*\n${text}`,
    { parse_mode: "Markdown" }
  ).catch(()=>{});
}

/* ===============================================
   LIST TESTS / PRACTICE
================================================ */

bot.onText(/\/list_tests/, async msg => {
  if (!ownerOnly(msg)) return;

  const dates = await Question.find({ type: "daily" }).distinct("date");
  const text = dates.length
    ? `📋 *Daily Tests*\n\n${dates.join("\n")}`
    : "❌ No daily tests found";

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  ownerLog("Viewed daily test list");
});

bot.onText(/\/list_practice/, async msg => {
  if (!ownerOnly(msg)) return;

  const dates = await Question.find({ type: "practice" }).distinct("date");
  const text = dates.length
    ? `📋 *Practice Sets*\n\n${dates.join("\n")}`
    : "❌ No practice sets found";

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  ownerLog("Viewed practice list");
});

/* ===============================================
   VIEW TEST / PRACTICE
================================================ */

async function viewQuestions(chatId, date, type) {
  const qs = await Question.find({ date, type });

  if (!qs.length) {
    return bot.sendMessage(chatId, "❌ No questions found for this date");
  }

  let text = `📅 *${type.toUpperCase()} — ${date}*\n\n`;

  qs.forEach((q, i) => {
    text +=
`Q${i+1}. ${q.q}
🅐 ${q.options[0]}
🅑 ${q.options[1]}
🅒 ${q.options[2]}
🅓 ${q.options[3]}
✅ Ans: ${["A","B","C","D"][q.correct]}

`;
  });

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

bot.onText(/\/view_test (\d{4}-\d{2}-\d{2})/, async (msg, m) => {
  if (!ownerOnly(msg)) return;
  await viewQuestions(msg.chat.id, m[1], "daily");
  ownerLog(`Viewed DAILY test ${m[1]}`);
});

bot.onText(/\/view_practice (\d{4}-\d{2}-\d{2})/, async (msg, m) => {
  if (!ownerOnly(msg)) return;
  await viewQuestions(msg.chat.id, m[1], "practice");
  ownerLog(`Viewed PRACTICE set ${m[1]}`);
});

/* ===============================================
   DELETE FULL TEST / PRACTICE
================================================ */

bot.onText(/\/delete_test (\d{4}-\d{2}-\d{2})/, async (msg, m) => {
  if (!ownerOnly(msg)) return;

  const count = await Question.countDocuments({ date: m[1], type: "daily" });
  if (!count) return bot.sendMessage(msg.chat.id, "❌ No test found");

  await Question.deleteMany({ date: m[1], type: "daily" });

  await bot.sendMessage(msg.chat.id,
    `🗑️ *Daily Test Deleted*\nDate: ${m[1]}`,
    { parse_mode: "Markdown" }
  );

  ownerLog(`Deleted DAILY test ${m[1]}`);
});

bot.onText(/\/delete_practice (\d{4}-\d{2}-\d{2})/, async (msg, m) => {
  if (!ownerOnly(msg)) return;

  const count = await Question.countDocuments({ date: m[1], type: "practice" });
  if (!count) return bot.sendMessage(msg.chat.id, "❌ No practice found");

  await Question.deleteMany({ date: m[1], type: "practice" });

  await bot.sendMessage(msg.chat.id,
    `🗑️ *Practice Set Deleted*\nDate: ${m[1]}`,
    { parse_mode: "Markdown" }
  );

  ownerLog(`Deleted PRACTICE set ${m[1]}`);
});

/* ===============================================
   DELETE SINGLE QUESTION
================================================ */

bot.onText(/\/delete_question (\d{4}-\d{2}-\d{2}) (\d+)/, async (msg, m) => {
  if (!ownerOnly(msg)) return;

  const date = m[1];
  const qno = Number(m[2]) - 1;

  const qs = await Question.find({ date });
  if (!qs[qno]) return bot.sendMessage(msg.chat.id, "❌ Invalid question number");

  await Question.deleteOne({ _id: qs[qno]._id });

  await bot.sendMessage(msg.chat.id,
    `🗑️ Question ${qno+1} deleted from ${date}`
  );

  ownerLog(`Deleted Question ${qno+1} from ${date}`);
});

/* ===============================================
   BASIC ANALYTICS
================================================ */

bot.onText(/\/stats/, async msg => {
  if (!ownerOnly(msg)) return;

  const totalUsers = await User.countDocuments();
  const totalTests = await Attempt.countDocuments();
  const totalQuestions = await Question.countDocuments();

  const text =
`📊 *BOT STATS*

👥 Total Users: ${totalUsers}
📝 Tests Attempted: ${totalTests}
❓ Total Questions: ${totalQuestions}
`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  ownerLog("Viewed global stats");
});

bot.onText(/\/today_stats/, async msg => {
  if (!ownerOnly(msg)) return;

  const today = todayDate();
  const attempts = await Attempt.countDocuments({ date: today });

  const text =
`📅 *Today's Stats (${today})*

🧪 Tests Attempted Today: ${attempts}
`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  ownerLog("Viewed today stats");
});

bot.onText(/\/total_users/, async msg => {
  if (!ownerOnly(msg)) return;

  const count = await User.countDocuments();
  await bot.sendMessage(msg.chat.id,
    `👥 Total Users: ${count}`
  );
  ownerLog("Checked total users");
});
/*************************************************
 * NEET ASPIRANTS BOT — PART 4
 * PRACTICE RANDOM ENGINE (30-DAY POOL)
 * ADD-ONLY MODULE
 *************************************************/

/* ===============================================
   CONFIG
================================================ */

const PRACTICE_POOL_DAYS = 30;
const PRACTICE_QUESTIONS_PER_TEST = 25;

/* ===============================================
   HELPERS
================================================ */

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/* ===============================================
   PRACTICE POOL FETCHER
================================================ */

async function getPracticePool() {
  const cutoff = daysAgo(PRACTICE_POOL_DAYS);

  const qs = await Question.find({
    type: "practice",
    date: { $gte: cutoff }
  });

  return qs;
}

/* ===============================================
   OVERRIDE PRACTICE START (SMART ENGINE)
================================================ */

async function startSmartPractice(chatId, userId) {
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "practice");
  }

  const pool = await getPracticePool();

  if (pool.length < PRACTICE_QUESTIONS_PER_TEST) {
    return bot.sendMessage(chatId,
      `⚠️ Practice pool me questions kam hain

Required: ${PRACTICE_QUESTIONS_PER_TEST}
Available: ${pool.length}

Owner ko boliye aur practice questions upload kare 🙏`
    );
  }

  // shuffle + pick 25 random
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, PRACTICE_QUESTIONS_PER_TEST);

  activeTests[userId] = {
    type: "practice",
    date: todayDate(),
    questions: selected,
    index: 0,
    score: 0,
    startTime: null
  };

  await bot.sendMessage(chatId,
`🔁 *Smart Practice Test*

🧠 Questions picked randomly
📆 Last ${PRACTICE_POOL_DAYS} days pool
📝 ${PRACTICE_QUESTIONS_PER_TEST} Questions
⏱️ 30 Minutes

👇 Ready?`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start Practice", callback_data: "start_practice_now" }],
          [{ text: "❌ Cancel", callback_data: "cancel_test" }]
        ]
      }
    }
  );
}

/* ===============================================
   CALLBACK EXTENSION
================================================ */

// NOTE: This safely EXTENDS existing callback handler
bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  // override practice button
  if (q.data === "practice_test") {
    return startSmartPractice(chatId, userId);
  }

  if (q.data === "start_practice_now") {
    const t = activeTests[userId];
    if (!t) return;

    t.startTime = Date.now();
    sendQuestion(chatId, userId);

    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId);
    }, 30 * 60 * 1000);
  }
});

/* ===============================================
   AUTO CLEANUP (30 DAYS PRACTICE)
================================================ */

cron.schedule("30 2 * * *", async () => {
  const cutoff = daysAgo(PRACTICE_POOL_DAYS);

  const deleted = await Question.deleteMany({
    type: "practice",
    date: { $lt: cutoff }
  });

  if (deleted.deletedCount > 0) {
    notifyOwner(
      `🧹 Practice auto-cleanup done\nDeleted: ${deleted.deletedCount} old questions`
    );
  }
});

/* ===============================================
   OWNER INFO COMMAND
================================================ */

bot.onText(/\/practice_pool/, async msg => {
  if (msg.from.id !== OWNER_ID) return;

  const pool = await getPracticePool();
  const dates = [...new Set(pool.map(q => q.date))];

  await bot.sendMessage(msg.chat.id,
`🧠 *Practice Pool Status*

📦 Total Questions: ${pool.length}
📆 Active Days: ${dates.length}
🕒 Pool Range: Last ${PRACTICE_POOL_DAYS} days

✅ Random selection enabled`,
    { parse_mode: "Markdown" }
  );
});

