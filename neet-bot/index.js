/*************************************************
 * NEET ASPIRANTS BOT — PART 1
 * CORE USER ENGINE (FINAL, LOCKED)
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

/* ================= HELPERS (SINGLE SOURCE) ================= */

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

const activeTests = {};   // userId → test session
const joinPending = {};  // userId → pending action

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

  const welcome = `
👋 *Welcome to NEET Aspirants Bot*

Designed for serious NEET Biology students.
Daily tests • Practice • Progress tracking

👇 Select an option to continue
`;

  await bot.sendMessage(chatId, welcome, { parse_mode: "Markdown" });
  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId, "🚀 *START NOW*", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 START NOW", callback_data: "main_menu" }]]
    }
  });
});

/* ================= FORCE JOIN UI ================= */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;

  await bot.sendMessage(chatId,
`🔒 *Channel Join Required*

Is bot ke saare features use karne ke liye
aapko pehle hamara official channel join karna hoga.

👇 Steps:
1️⃣ “Join Channel” par tap karein
2️⃣ Join ke baad “I have joined” dabayein`,
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

/* ================= LEADERBOARD (TOP 10) ================= */

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
    text += "No attempts yet today.\nBe the first 💪";
  } else {
    rows.forEach((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}.`;
      text += `${medal} Score: ${r.score}/25 | ⏱️ ${Math.floor(r.timeTaken/60)}m ${r.timeTaken%60}s\n`;
    });
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= TIMER ================= */

function remainingTime(t) {
  const total = 25 * 60; // 25 questions = 25 minutes
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const left = Math.max(total - elapsed, 0);
  return {
    min: Math.floor(left / 60),
    sec: left % 60
  };
}

/* ================= START TEST ================= */

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) return requireJoin(chatId, userId, type);

  const date = todayDate();

  if (type === "daily" && !isOwnerUser(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) {
      return bot.sendMessage(chatId,
        "❌ You already attempted today’s test\nCome back tomorrow 💪"
      );
    }
  }

  const qs = await Question.find({ date, type });
  if (!qs.length) {
    return bot.sendMessage(chatId,
      "⏳ Today’s test will be available soon.\nMeanwhile, try Practice 💪"
    );
  }

  activeTests[userId] = {
    type,
    date,
    questions: qs.sort(() => Math.random() - 0.5).slice(0, 25),
    index: 0,
    score: 0,
    answered: false,
    startTime: null
  };

  await bot.sendMessage(chatId,
`🧬 *${type === "daily" ? "Daily Biology Test" : "Practice Biology"}*

📝 Total Questions: 25
⏱️ Time Limit: 25 Minutes

👇 Ready?`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start", callback_data: "start_now" }],
          [{ text: "❌ Cancel", callback_data: "cancel" }]
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
⏱️ Time Left: ${time.min} min ${time.sec} sec

${q.q}

🅐 ${q.options[0]}        🅑 ${q.options[1]}
🅒 ${q.options[2]}        🅓 ${q.options[3]}`,
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

/* ================= CALLBACK ROUTER (SINGLE) ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const t = activeTests[userId];

  /* MAIN MENU */
  if (q.data === "main_menu") {
    return bot.sendMessage(chatId, "🔥 Let’s improve your NEET score", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧬 Take Today’s Test", callback_data: "daily" }],
          [{ text: "🔁 Practice Biology", callback_data: "practice" }],
          [{ text: "📊 My Progress", callback_data: "progress" }],
          [{ text: "☎️ Contact Owner", url: SUPPORT_BOT_URL }]
        ]
      }
    });
  }

  if (q.data === "daily") return startTest(chatId, userId, "daily");
  if (q.data === "practice") return startTest(chatId, userId, "practice");

  if (q.data === "start_now") {
    if (!t) return;
    t.startTime = Date.now();
    sendQuestion(chatId, userId);
    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId, true);
    }, 25 * 60 * 1000);
    return;
  }

  if (q.data.startsWith("ans_")) {
    if (!t || t.answered) return;
    t.answered = true;

    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];
    const correct = sel === cq.correct;
    if (correct) t.score++;

    return bot.sendMessage(chatId,
      correct
        ? `✅ Correct!\n\n✔️ ${cq.reason}`
        : `❌ Wrong!\n\n✅ Correct: ${["🅐","🅑","🅒","🅓"][cq.correct]}\n✔️ ${cq.reason}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "➡️ Next Question", callback_data: "next" }]]
        }
      }
    );
  }

  if (q.data === "next") {
    if (!t) return;
    t.index++;
    if (t.index >= t.questions.length) return finishTest(chatId, userId, false);
    return sendQuestion(chatId, userId);
  }

  if (q.data === "progress") return showProgress(chatId, userId);

  if (q.data === "check_join") {
    if (await isJoined(userId)) {
      const next = joinPending[userId];
      delete joinPending[userId];
      if (next) startTest(chatId, userId, next);
    }
  }
});

/* ================= FINISH TEST ================= */

async function finishTest(chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);

  if (t.type === "daily" && !isOwnerUser(userId)) {
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
timeOver
? `⏰ *Time Over! Test Auto-Submitted*\n\n⭐ Score: ${t.score} / 25`
: `✅ *Test Completed* 🎉\n\n⭐ Score: ${t.score} / 25\n⏱️ Time: ${Math.floor(timeTaken/60)}m ${timeTaken%60}s`,
    { parse_mode: "Markdown" }
  );

  if (t.type === "daily") {
    await showLeaderboard(chatId, t.date);
    await bot.sendMessage(chatId, "🚀 START NOW", {
      reply_markup: {
        inline_keyboard: [[{ text: "🚀 START NOW", callback_data: "main_menu" }]]
      }
    });
  }
}

/* ================= PROGRESS ================= */

async function showProgress(chatId, userId) {
  const u = await User.findOne({ user_id: userId });
  if (!u) return;

  const avg = u.totalTests ? (u.totalScore / u.totalTests).toFixed(1) : "0";

  await bot.sendMessage(chatId,
`📊 *My Progress Snapshot*

🧬 Daily Tests
• Attempts: ${u.totalTests}
• Avg Score: ${avg} / 25

🔁 Practice
• Sessions: ${u.practiceTests}
• Accuracy: ${
  u.practiceCorrect + u.practiceWrong
    ? ((u.practiceCorrect / (u.practiceCorrect + u.practiceWrong)) * 100).toFixed(1)
    : 0
}%`,
    { parse_mode: "Markdown" }
  );
}

/*************************************************
 * NEET ASPIRANTS BOT — PART 2
 * OWNER UPLOAD + /DONE + STRONG PARSER
 * ADD-ONLY MODULE (SAFE WITH PART-1)
 *************************************************/

/* ================= OWNER STATE ================= */

const ADMIN = {
  uploads: {},   // { ownerId: { type, step, date, buffer } }
  logs: []
};

function ownerLog(text) {
  ADMIN.logs.unshift(`• ${text} (${new Date().toLocaleString()})`);
  ADMIN.logs = ADMIN.logs.slice(0, 20);
  bot.sendMessage(OWNER_ID, `📜 OWNER LOG\n${text}`).catch(()=>{});
}

function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ================= OWNER PANEL ENTRY ================= */

bot.onText(/\/owner_panel/, async msg => {
  if (!isOwnerUser(msg.from.id)) return;

  await bot.sendMessage(msg.chat.id,
`👑 *OWNER CONTROL PANEL*

Choose what you want to do 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Upload Daily Test", callback_data: "admin_daily_upload" }],
          [{ text: "🔁 Upload Practice Bank", callback_data: "admin_practice_upload" }],
          [{ text: "📜 Owner Logs", callback_data: "admin_logs" }]
        ]
      }
    }
  );
});

/* ================= START DAILY UPLOAD ================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_daily_upload") {
    ADMIN.uploads[OWNER_ID] = {
      type: "daily",
      step: "date",
      date: null,
      buffer: ""
    };

    ownerLog("Started DAILY upload");

    return bot.sendMessage(OWNER_ID,
`📅 *Daily Test Upload*

Send date in format:
YYYY-MM-DD`,
      { parse_mode: "Markdown" }
    );
  }
});

/* ================= START PRACTICE UPLOAD ================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_practice_upload") {
    ADMIN.uploads[OWNER_ID] = {
      type: "practice",
      step: "date",
      date: null,
      buffer: ""
    };

    ownerLog("Started PRACTICE upload");

    return bot.sendMessage(OWNER_ID,
`📅 *Practice Question Bank*

Send date (for grouping only):
YYYY-MM-DD`,
      { parse_mode: "Markdown" }
    );
  }
});

/* ================= STRONG QUESTION PARSER ================= */

/*
SUPPORTED FORMAT (copy-paste friendly):

Q1. Question text
A) option
B) option
C) option
D) option
Ans: B
Reason: explanation

(blank line allowed)
*/

function parseQuestions(raw) {
  const blocks = raw
    .split(/\n\s*\n+/)
    .map(b => b.trim())
    .filter(Boolean);

  const out = [];

  for (const block of blocks) {
    const qMatch = block.match(/Q\d*\.?\s*(.+)/i);
    const opts = [...block.matchAll(/^[A-D]\)\s*(.+)$/gm)];
    const ans = block.match(/Ans:\s*([A-D])/i);
    const reason = block.match(/Reason:\s*(.+)/i);

    if (!qMatch || opts.length !== 4 || !ans) continue;

    out.push({
      q: qMatch[1].trim(),
      options: opts.map(o => o[1].trim()),
      correct: ["A","B","C","D"].indexOf(ans[1].toUpperCase()),
      reason: reason ? reason[1].trim() : "Explanation not provided"
    });
  }

  return out;
}

/* ================= OWNER MESSAGE HANDLER ================= */

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;

  const session = ADMIN.uploads[OWNER_ID];
  if (!session) return;

  /* STEP 1: DATE */
  if (session.step === "date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(OWNER_ID, "❌ Invalid date format. Use YYYY-MM-DD");
    }

    const exists = await Question.countDocuments({ date: d, type: session.type });
    session.date = d;

    if (exists > 0) {
      session.step = "confirm";
      return bot.sendMessage(OWNER_ID,
`⚠️ ${session.type.toUpperCase()} already exists for ${d}

Overwrite existing questions?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Overwrite", callback_data: "admin_overwrite_yes" }],
              [{ text: "❌ Cancel", callback_data: "admin_overwrite_no" }]
            ]
          }
        }
      );
    }

    session.step = "questions";
    return bot.sendMessage(OWNER_ID,
`📝 Paste all questions now
(you can send multiple messages)

Send /done when finished`);
  }

  /* STEP 2: QUESTIONS */
  if (session.step === "questions" && msg.text && !msg.text.startsWith("/")) {
    session.buffer += "\n" + msg.text;
    const parsed = parseQuestions(session.buffer);

    return bot.sendMessage(OWNER_ID,
`📝 Detected questions so far: ${parsed.length}`);
  }
});

/* ================= OVERWRITE CONFIRM ================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  const session = ADMIN.uploads[OWNER_ID];
  if (!session) return;

  if (q.data === "admin_overwrite_no") {
    delete ADMIN.uploads[OWNER_ID];
    ownerLog("Upload cancelled");
    return bot.sendMessage(OWNER_ID, "❌ Upload cancelled");
  }

  if (q.data === "admin_overwrite_yes") {
    await Question.deleteMany({ date: session.date, type: session.type });
    session.step = "questions";
    ownerLog(`Overwrite confirmed for ${session.type} ${session.date}`);

    return bot.sendMessage(OWNER_ID,
`📝 Old data deleted.
Paste new questions now
Send /done when finished`);
  }
});

/* ================= /DONE FINAL SUBMIT ================= */

bot.onText(/\/done/, async msg => {
  if (!isOwnerUser(msg.from.id)) return;

  const session = ADMIN.uploads[OWNER_ID];
  if (!session) {
    return bot.sendMessage(OWNER_ID, "❌ No active upload session");
  }

  const parsed = parseQuestions(session.buffer);

  if (parsed.length === 0) {
    return bot.sendMessage(OWNER_ID, "❌ No valid questions detected");
  }

  if (session.type === "daily" && parsed.length !== 25) {
    return bot.sendMessage(OWNER_ID,
`❌ Daily test must have EXACTLY 25 questions
Detected: ${parsed.length}`);
  }

  await Question.insertMany(parsed.map(q => ({
    ...q,
    date: session.date,
    type: session.type
  })));

  ownerLog(
    `${session.type.toUpperCase()} uploaded — ${session.date} (${parsed.length} Q)`
  );

  await bot.sendMessage(OWNER_ID,
`✅ Upload successful

📅 Date: ${session.date}
📝 Questions: ${parsed.length}`);

  delete ADMIN.uploads[OWNER_ID];
});

/* ================= OWNER LOG VIEW ================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_logs") {
    const logs = ADMIN.logs.length
      ? ADMIN.logs.join("\n")
      : "No logs yet";

    return bot.sendMessage(OWNER_ID,
`📜 *OWNER LOGS*\n\n${logs}`,
      { parse_mode: "Markdown" }
    );
  }
});
/*************************************************
 * NEET ASPIRANTS BOT — PART 3
 * PRACTICE RANDOM ENGINE + ANALYTICS
 * ADD-ONLY • SAFE • LOCKED
 *************************************************/

/* =================================================
   PRACTICE RANDOM ENGINE (30–DAY / FULL POOL)
================================================= */

/*
RULES (LOCKED):
• Practice questions = unlimited bank
• Owner ek saath 100–200+ Q upload kare
• User ko har attempt me RANDOM 25 milenge
• Daily test se completely independent
• Practice attempts unlimited
• No leaderboard, no rank
*/

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
   OVERRIDE PRACTICE START (SAFE HOOK)
================================================= */

/*
We hook ONLY practice flow.
Daily test logic remains untouched.
*/

const originalStartTest = startTest;

startTest = async function (chatId, userId, type) {
  if (type !== "practice") {
    return originalStartTest(chatId, userId, type);
  }

  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "practice");
  }

  const qs = await getRandomPracticeQuestions();

  if (!qs.length) {
    return bot.sendMessage(chatId,
      "❌ Practice question bank not ready yet.\nPlease try later."
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

  const intro =
`🔁 *Biology Practice Test*

📝 Total Questions: 25
⏱️ Time Limit: 25 Minutes
📚 Purpose: Learning + Concept clarity

📌 Rules:
• Practice test multiple times de sakte ho
• Score leaderboard me count nahi hota
• Har question ke baad reason milega
• Timer rukega nahi
• 25 min baad auto-submit

👇 Ready ho?`;

  await bot.sendMessage(chatId, intro, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ Start Practice", callback_data: "start_now" }],
        [{ text: "❌ Cancel", callback_data: "cancel" }]
      ]
    }
  });
};

/* =================================================
   PRACTICE FINISH SCREEN (DETAILED)
================================================= */

const originalFinishTest = finishTest;

finishTest = async function (chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  // DAILY → original logic
  if (t.type === "daily") {
    return originalFinishTest(chatId, userId, timeOver);
  }

  // PRACTICE RESULT
  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);
  const correct = t.score;
  const wrong = 25 - correct;
  const accuracy = ((correct / 25) * 100).toFixed(1);

  await User.updateOne(
    { user_id: userId },
    {
      $inc: {
        practiceTests: 1,
        practiceCorrect: correct,
        practiceWrong: wrong
      }
    }
  );

  delete activeTests[userId];

  const result =
`✅ *Practice Session Completed* 🎯

📝 Total Questions: 25
✔️ Correct: ${correct}
❌ Wrong: ${wrong}
⏱️ Time Taken: ${Math.floor(timeTaken/60)} min ${timeTaken%60} sec

📊 Accuracy: ${accuracy}%

💡 Tip:
Weak concepts revise karo
Practice repeat karo`;

  await bot.sendMessage(chatId, result, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔁 Practice Again", callback_data: "practice" }],
        [{ text: "🚀 START NOW", callback_data: "main_menu" }]
      ]
    }
  });
};

/* =================================================
   ANALYTICS — OWNER SIDE (SAFE)
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_analytics") {
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

    const practiceSessions = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$practiceTests" } } }
    ]);

    await bot.sendMessage(OWNER_ID,
`📊 *BOT ANALYTICS*

👥 Total Users: ${totalUsers}

🧬 Daily Test (Today)
• Attempts: ${todayAttempts}
• Avg Score: ${avgScore} / 25

🔁 Practice
• Total Practice Sessions: ${
  practiceSessions[0]?.total || 0
}

⏱️ Status: Bot running smoothly`,
      { parse_mode: "Markdown" }
    );
  }
});
/*************************************************
 * NEET ASPIRANTS BOT — PART 4
 * ADMIN VIEW / DELETE / EMERGENCY / MIDNIGHT
 * OWNER ONLY • BUTTON UI • SAFE ADD-ONLY
 *************************************************/

/* =================================================
   OWNER CONTROL ENTRY (BUTTON)
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_manage_tests") {
    return bot.sendMessage(OWNER_ID,
`🛠️ *TEST MANAGEMENT*

Choose what you want to manage 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 View Daily Tests", callback_data: "admin_view_daily" }],
            [{ text: "📋 View Practice Bank", callback_data: "admin_view_practice" }],
            [{ text: "🗑️ Delete Daily Test", callback_data: "admin_delete_daily" }],
            [{ text: "🗑️ Delete Practice Data", callback_data: "admin_delete_practice" }],
            [{ text: "⬅️ Back", callback_data: "owner_panel" }]
          ]
        }
      }
    );
  }
});

/* =================================================
   VIEW DAILY TESTS
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_view_daily") {
    const dates = await Question.find({ type: "daily" }).distinct("date");

    return bot.sendMessage(OWNER_ID,
`📋 *DAILY TESTS*

${dates.length ? dates.join("\n") : "No daily tests uploaded"}`,
      { parse_mode: "Markdown" }
    );
  }
});

/* =================================================
   VIEW PRACTICE BANK
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_view_practice") {
    const total = await Question.countDocuments({ type: "practice" });

    return bot.sendMessage(OWNER_ID,
`📋 *PRACTICE QUESTION BANK*

🧠 Total Questions: ${total}

📌 Practice system:
• Random 25 per attempt
• Unlimited attempts
• No leaderboard`,
      { parse_mode: "Markdown" }
    );
  }
});

/* =================================================
   DELETE DAILY TEST (DATE INPUT)
================================================= */

const ADMIN_DELETE = {};

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_delete_daily") {
    ADMIN_DELETE.step = "daily_date";
    return bot.sendMessage(OWNER_ID,
`🗑️ *Delete Daily Test*

Send date to delete:
YYYY-MM-DD`);
  }
});

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;
  if (ADMIN_DELETE.step !== "daily_date") return;

  const d = msg.text?.trim();
  if (!validDate(d)) {
    return bot.sendMessage(OWNER_ID, "❌ Invalid date format");
  }

  const count = await Question.countDocuments({ date: d, type: "daily" });
  await Question.deleteMany({ date: d, type: "daily" });
  await Attempt.deleteMany({ date: d });

  ADMIN_DELETE.step = null;

  ownerLog(`Daily test deleted — ${d} (${count} Q)`);

  await bot.sendMessage(OWNER_ID,
`✅ *Daily Test Deleted*

📅 Date: ${d}
🧪 Questions removed: ${count}`,
    { parse_mode: "Markdown" }
  );
});

/* =================================================
   DELETE PRACTICE BANK (FULL)
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_delete_practice") {
    const total = await Question.countDocuments({ type: "practice" });

    await Question.deleteMany({ type: "practice" });

    ownerLog(`Practice bank cleared (${total} Q)`);

    return bot.sendMessage(OWNER_ID,
`🗑️ *Practice Bank Cleared*

🧠 Questions deleted: ${total}`,
      { parse_mode: "Markdown" }
    );
  }
});

/* =================================================
   EMERGENCY CONTROLS
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_emergency") {
    return bot.sendMessage(OWNER_ID,
`⚙️ *EMERGENCY CONTROLS*

Use carefully 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚨 Force New Day", callback_data: "admin_force_new_day" }],
            [{ text: "📢 Send Test Alert", callback_data: "admin_manual_broadcast" }],
            [{ text: "⬅️ Back", callback_data: "owner_panel" }]
          ]
        }
      }
    );
  }
});

/* =================================================
   FORCE NEW DAY (MANUAL)
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_force_new_day") {
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

    ownerLog(`Force new day triggered — ${sent} users notified`);

    return bot.sendMessage(OWNER_ID,
`✅ *New Day Forced*

📢 Notifications sent: ${sent}`,
      { parse_mode: "Markdown" }
    );
  }
});

/* =================================================
   MANUAL BROADCAST (OWNER)
================================================= */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_manual_broadcast") {
    ADMIN_DELETE.step = "broadcast";
    return bot.sendMessage(OWNER_ID,
`📢 *Manual Broadcast*

Send message text now`);
  }
});

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;
  if (ADMIN_DELETE.step !== "broadcast") return;

  const users = await User.find({});
  let sent = 0;

  for (const u of users) {
    try {
      await bot.sendMessage(u.user_id, msg.text);
      sent++;
    } catch {}
  }

  ADMIN_DELETE.step = null;

  ownerLog(`Manual broadcast sent to ${sent} users`);

  await bot.sendMessage(OWNER_ID,
`✅ *Broadcast Completed*

👥 Users reached: ${sent}`,
    { parse_mode: "Markdown" }
  );
});

/* =================================================
   MIDNIGHT REPORT (AUTO)
================================================= */

cron.schedule("0 0 * * *", async () => {
  const today = todayDate();
  const attempts = await Attempt.countDocuments({ date: today });

  ownerLog(`Midnight report: ${attempts} attempts today`);
});


/*************************************************
 * NEET ASPIRANTS BOT — PART 5
 * FINAL OWNER PANEL POLISH
 * ALL BUTTONS • ZERO TEXT COMMANDS
 *************************************************/

/* ===============================================
   OWNER PANEL ENTRY POINT
================================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "open_owner_panel") {
    return bot.sendMessage(OWNER_ID,
`👑 *OWNER CONTROL CENTER*

Manage everything from here 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📤 Upload & Question Bank", callback_data: "panel_uploads" }],
            [{ text: "📋 View / Delete Data", callback_data: "admin_manage_tests" }],
            [{ text: "📊 Analytics & Stats", callback_data: "panel_analytics" }],
            [{ text: "⚙️ Emergency & Broadcast", callback_data: "admin_emergency" }],
            [{ text: "📜 Owner Logs", callback_data: "panel_logs" }]
          ]
        }
      }
    );
  }
});

/* ===============================================
   UPLOAD PANEL
================================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "panel_uploads") {
    return bot.sendMessage(OWNER_ID,
`📤 *UPLOAD & QUESTION BANK*

Choose upload type 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧬 Upload Daily Test (25 Q)", callback_data: "admin_upload_daily" }],
            [{ text: "🔁 Upload Practice Questions", callback_data: "admin_upload_practice" }],
            [{ text: "⬅️ Back", callback_data: "open_owner_panel" }]
          ]
        }
      }
    );
  }
});

/* ===============================================
   ANALYTICS PANEL
================================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "panel_analytics") {
    const totalUsers = await User.countDocuments();
    const totalAttempts = await Attempt.countDocuments();
    const totalPractice = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$practiceTests" } } }
    ]);

    return bot.sendMessage(OWNER_ID,
`📊 *BOT ANALYTICS SNAPSHOT*

👥 Total Users: ${totalUsers}
🧪 Total Daily Attempts: ${totalAttempts}
🔁 Practice Sessions: ${totalPractice[0]?.total || 0}

📌 Leaderboard + Progress auto tracked`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬅️ Back", callback_data: "open_owner_panel" }]
          ]
        }
      }
    );
  }
});

/* ===============================================
   OWNER LOG VIEW
================================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "panel_logs") {
    const logs =
      ADMIN.logs.length
        ? ADMIN.logs.join("\n")
        : "No recent admin actions";

    return bot.sendMessage(OWNER_ID,
`📜 *OWNER ACTION LOGS*

${logs}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬅️ Back", callback_data: "open_owner_panel" }]
          ]
        }
      }
    );
  }
});

/* ===============================================
   OWNER PANEL ENTRY BUTTON
   (Shown ONLY to OWNER)
================================================ */

bot.on("callback_query", async q => {
  if (q.data !== "main_menu") return;
  if (!isOwnerUser(q.from.id)) return;

  await bot.sendMessage(q.message.chat.id,
`👑 *OWNER QUICK ACCESS*`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "👑 Open Owner Panel", callback_data: "open_owner_panel" }]
        ]
      }
    }
  );
});
