/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 0
 * FOUNDATION / BOOTSTRAP
 * FILE ORDER SAFE • RENDER SAFE
 *************************************************/

require("dotenv").config();

/* ================= CORE IMPORTS ================= */

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");

/* ================= ENV CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPPORT_BOT_URL = process.env.SUPPORT_BOT_URL;

if (!BOT_TOKEN || !OWNER_ID || !CHANNEL_USERNAME || !WEBHOOK_URL) {
  throw new Error("❌ Missing required ENV variables");
}

/* ================= BOT + SERVER ================= */

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB connection failed", err);
    process.exit(1);
  });

/* ================= WEBHOOK ================= */

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(10000, async () => {
  await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
  console.log("🚀 Bot running (FOUNDATION)");
});

/* ================= GLOBAL HELPERS ================= */

const todayDate = () => new Date().toISOString().split("T")[0];

const isOwnerUser = (id) => id === OWNER_ID;

/* ================= FORCE JOIN CHECK ================= */

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

/* ================= GLOBAL STATE ================= */

// Active test sessions
const activeTests = {};   // userId -> test object

// Pending force-join actions
const joinPending = {};   // userId -> "daily" | "practice"

/* ================= SAFETY FLAGS ================= */

// Maintenance mode (BLOCK-5 will control this)
let MAINTENANCE_MODE = false;


/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 1
 * /START + LEADERBOARD BASE
 *************************************************/

/* ================= DATABASE MODELS ================= */

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

const Attempt = mongoose.model("Attempt", new mongoose.Schema({
  user_id: Number,
  date: String,
  score: Number,
  timeTaken: Number
}));

/* ================= /START ================= */

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  let user = await User.findOne({ user_id: userId });
  if (!user) {
    await User.create({
      user_id: userId,
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

  await showDailyLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId,
"🚀 *START NOW*",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 START NOW", callback_data: "main_menu" }]
        ]
      }
    }
  );
});

/* ================= DAILY LEADERBOARD ================= */

async function showDailyLeaderboard(chatId, date) {
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
        i === 2 ? "🥉" :
        `${i + 1}.`;

      text += `${rank} Score: ${r.score}/25 | ⏱️ ${Math.floor(r.timeTaken / 60)}m ${r.timeTaken % 60}s\n`;
    });
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= MAIN MENU CALLBACK ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  if (q.data === "main_menu") {
    return bot.sendMessage(chatId,
`🔥 *Let’s improve your NEET score*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧬 Take Today’s Test", callback_data: "daily" }],
            [{ text: "🔁 Practice More", callback_data: "practice" }],
            [{ text: "📊 View Progress", callback_data: "progress" }],
            [{ text: "☎️ Need Help?", url: SUPPORT_BOT_URL }]
          ]
        }
      }
    );
  }
});

/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 2
 * FORCE JOIN + CALLBACK ROUTER BASE
 *************************************************/

/* ================= FORCE JOIN CHECK ================= */

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

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
          [
            {
              text: "🔔 Join Channel",
              url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}`
            }
          ],
          [
            {
              text: "✅ I have joined",
              callback_data: "check_join"
            }
          ]
        ]
      }
    }
  );
}

/* ================= CALLBACK ROUTER (BASE) ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data;

  /* ===== FORCE JOIN CONFIRM ===== */
  if (data === "check_join") {
    if (await isJoined(userId)) {
      const next = joinPending[userId];
      delete joinPending[userId];

      await bot.sendMessage(chatId,
`✅ *Channel joined successfully!*

You can continue now 🚀`,
        { parse_mode: "Markdown" }
      );

      // Next action (daily / practice) later blocks handle karenge
      return;
    }

    return bot.sendMessage(chatId,
`❌ *You haven't joined yet*

Please join the channel first.`,
      { parse_mode: "Markdown" }
    );
  }

  /* ===== PROTECTED ENTRIES (PLACEHOLDERS) ===== */
  // Yahan future blocks inject honge:
  // - daily
  // - practice
  // - progress
  // - owner callbacks

});


/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 3
 * DAILY TEST ENGINE (LOCKED)
 *************************************************/

/* ================= TIMER HELPER ================= */

function remainingTime(t) {
  const TOTAL = 30 * 60; // 30 minutes
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  const left = Math.max(TOTAL - elapsed, 0);

  return {
    min: Math.floor(left / 60),
    sec: left % 60
  };
}

/* ================= START DAILY TEST ================= */

async function startDailyTest(chatId, userId) {
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "daily");
  }

  const date = todayDate();

  // Only 1 attempt per day (except owner)
  if (!isOwnerUser(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) {
      return bot.sendMessage(chatId,
`❌ *You already attempted today's test*

Come back tomorrow 💪`,
        { parse_mode: "Markdown" }
      );
    }
  }

  const qs = await Question.find({ date, type: "daily" });
  if (qs.length !== 25) {
    return bot.sendMessage(chatId,
`⏳ *Daily test not available yet*

Please try again later.`,
      { parse_mode: "Markdown" }
    );
  }

  activeTests[userId] = {
    type: "daily",
    date,
    questions: qs,
    index: 0,
    score: 0,
    answered: false,
    startTime: null
  };

  await bot.sendMessage(chatId,
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

async function sendDailyQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  const time = remainingTime(t);

  t.answered = false;

  await bot.sendMessage(chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${time.min} min ${time.sec} sec

${q.q}

🅐 ${q.options[0]}
🅑 ${q.options[1]}
🅒 ${q.options[2]}
🅓 ${q.options[3]}

👇 Choose the correct option`,
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

  await bot.sendMessage(chatId,
timeOver
? `⏰ *Time Over — Test Auto Submitted*

⭐ Score: ${t.score} / 25`
: `✅ *Daily Test Completed 🎉*

⭐ Score: ${t.score} / 25
⏱️ Time Taken: ${Math.floor(timeTaken/60)} min ${timeTaken%60} sec`,
    { parse_mode: "Markdown" }
  );

  await showLeaderboard(chatId, t.date);

  await bot.sendMessage(chatId,
"🚀 START NOW",
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "🚀 START NOW", callback_data: "main_menu" }]
    ]
  }
});
}
// ================= CALLBACK INJECTION =================

// DAILY ENTRY
if (data === "daily") {
  return startTest(chatId, userId, "daily");
}

// DAILY START
if (data === "daily_start" && activeTests[userId]) {
  const t = activeTests[userId];
  t.startTime = Date.now();

  sendDailyQuestion(chatId, userId);

  setTimeout(() => {
    if (activeTests[userId]) {
      finishDailyTest(chatId, userId, true);
    }
  }, 30 * 60 * 1000);

  return;
}
// ANSWER (ONE-TIME CLICK)
if (data.startsWith("ans_") && activeTests[userId]) {
  const t = activeTests[userId];
  if (t.answered) return;

  t.answered = true;

  const selected = Number(data.split("_")[1]);
  const q = t.questions[t.index];

  const correct = selected === q.correct;
  if (correct) t.score++;

  return bot.sendMessage(chatId,
correct
? `✅ *Correct!*\n\n✔️ ${q.reason}`
: `❌ *Wrong!*\n\n✅ Correct Answer: ${["🅐","🅑","🅒","🅓"][q.correct]}\n✔️ ${q.reason}`,
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

// NEXT QUESTION
if (data === "daily_next" && activeTests[userId]) {
  const t = activeTests[userId];
  t.index++;

  if (t.index >= 25) {
    return finishDailyTest(chatId, userId, false);
  }

  return sendDailyQuestion(chatId, userId);
}


/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 4
 * PRACTICE TEST ENGINE (RANDOM + LOCKED)
 *************************************************/

/* ================= PRACTICE RANDOM PICKER ================= */

async function getRandomPracticeQuestions() {
  const total = await Question.countDocuments({ type: "practice" });
  if (total < 25) return [];

  const skip = Math.floor(Math.random() * (total - 25));
  return Question.find({ type: "practice" })
    .skip(skip)
    .limit(25);
}

/* ================= PRACTICE START ================= */

async function startPracticeTest(chatId, userId) {
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "practice");
  }

  const qs = await getRandomPracticeQuestions();
  if (!qs.length) {
    return bot.sendMessage(chatId,
`⏳ *Practice questions not available yet*

Please try again later 💪`,
      { parse_mode: "Markdown" }
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
⏱️ Time Limit: 30 Minutes
📚 Purpose: Learning + Concept clarity

📌 Rules:
• Practice multiple times allowed
• No leaderboard / no rank
• Every question has explanation
• Timer never pauses

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

async function sendPracticeQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  const time = remainingTime(t);

  t.answered = false;

  await bot.sendMessage(chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${time.min} min ${time.sec} sec

${q.q}

🅐 ${q.options[0]}
🅑 ${q.options[1]}
🅒 ${q.options[2]}
🅓 ${q.options[3]}

👇 Choose the correct option`,
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

/* ================= FINISH PRACTICE TEST ================= */

async function finishPracticeTest(chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

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

  await bot.sendMessage(chatId,
`✅ *Practice Session Completed 🎯*

📝 Total Questions: 25
✔️ Correct: ${correct}
❌ Wrong: ${wrong}
⏱️ Time Taken: ${Math.floor(timeTaken/60)} min ${timeTaken%60} sec

📊 Accuracy: ${accuracy} %

💡 Tip:
Weak concepts revise karo
Practice repeat karo`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔁 Practice Again", callback_data: "practice" }],
          [{ text: "🚀 START NOW", callback_data: "main_menu" }]
        ]
      }
    }
  );
}

/* ================= CALLBACK INJECTION ================= */

// ⬇️ ADD THESE INSIDE BLOCK-2 CALLBACK ROUTER ⬇️

// PRACTICE ENTRY
if (data === "practice") {
  return startPracticeTest(chatId, userId);
}

// PRACTICE START
if (data === "practice_start" && activeTests[userId]) {
  const t = activeTests[userId];
  t.startTime = Date.now();

  sendPracticeQuestion(chatId, userId);

  setTimeout(() => {
    if (activeTests[userId]) {
      finishPracticeTest(chatId, userId, true);
    }
  }, 30 * 60 * 1000);

  return;
}

// PRACTICE ANSWER (ONE CLICK ONLY)
if (data.startsWith("p_ans_") && activeTests[userId]) {
  const t = activeTests[userId];
  if (t.answered) return;

  t.answered = true;

  const selected = Number(data.split("_")[2]);
  const q = t.questions[t.index];

  const correct = selected === q.correct;
  if (correct) t.score++;

  return bot.sendMessage(chatId,
correct
? `✅ *Correct!*\n\n✔️ ${q.reason}`
: `❌ *Wrong!*\n\n✅ Correct Answer: ${["🅐","🅑","🅒","🅓"][q.correct]}\n✔️ ${q.reason}`,
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

// PRACTICE NEXT
if (data === "practice_next" && activeTests[userId]) {
  const t = activeTests[userId];
  t.index++;

  if (t.index >= 25) {
    return finishPracticeTest(chatId, userId, false);
  }

  return sendPracticeQuestion(chatId, userId);
}

/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 5
 * OWNER UPLOAD ENGINE (DAILY + PRACTICE)
 *************************************************/

/* ================= OWNER STATE ================= */

const ADMIN = {
  uploads: {},   // ownerId → { type, step, date, buffer }
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
/*
FORMAT (copy-paste safe):

Q1. Question text
A) option
B) option
C) option
D) option
Ans: B
Reason: explanation
*/

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

/* =====================================================
   OWNER CALLBACK HANDLER (EXTENDS BLOCK-2)
===================================================== */

const originalOwnerCallbacks_B5 = typeof handleOwnerCallbacks === "function"
  ? handleOwnerCallbacks
  : async () => false;

handleOwnerCallbacks = async function (data, chatId, userId) {
  const handled = await originalOwnerCallbacks_B5(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  const session = ADMIN.uploads[userId];

  /* ===== OWNER PANEL ===== */
 if (data === "OWNER_PANEL") {
  await bot.sendMessage(chatId,
`👑 OWNER CONTROL PANEL

Choose an action 👇`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Upload & Question Bank", callback_data: "UPLOAD_BANK" }],
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
  /* ===== DAILY UPLOAD START ===== */
  if (data === "ADMIN_DAILY") {
    if (session) {
      await bot.sendMessage(chatId, "⚠️ Finish current upload first using /done");
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
`📅 DAILY TEST UPLOAD

Send date in format:
YYYY-MM-DD`);
    return true;
  }

  /* ===== PRACTICE UPLOAD START ===== */
  if (data === "ADMIN_PRACTICE") {
    if (session) {
      await bot.sendMessage(chatId, "⚠️ Finish current upload first using /done");
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
`📅 PRACTICE QUESTION BANK

Send date (grouping only):
YYYY-MM-DD`);
    return true;
  }

  /* ===== OVERWRITE YES ===== */
  if (data === "ADMIN_OVERWRITE_YES") {
    if (!session) return true;

    await Question.deleteMany({ date: session.date, type: session.type });
    session.step = "questions";

    ownerLog(`Overwrite confirmed: ${session.type} ${session.date}`);

    await bot.sendMessage(chatId,
`📝 Old data deleted.
Paste questions now
Send /done when finished`);
    return true;
  }

  /* ===== OVERWRITE NO ===== */
  if (data === "ADMIN_OVERWRITE_NO") {
    delete ADMIN.uploads[userId];
    ownerLog("Upload cancelled");

    await bot.sendMessage(chatId, "❌ Upload cancelled");
    return true;
  }

  /* ===== OWNER LOGS ===== */
  if (data === "ADMIN_LOGS") {
    await bot.sendMessage(chatId,
`📜 OWNER LOGS

${ADMIN.logs.length ? ADMIN.logs.join("\n") : "No logs yet"}`);
    return true;
  }

  return false;
};

/* ================= OWNER MESSAGE FLOW ================= */

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) return;

  /* ---- DATE STEP ---- */
  if (session.step === "date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(msg.chat.id, "❌ Invalid date. Use YYYY-MM-DD");
    }

    const exists = await Question.countDocuments({
      date: d,
      type: session.type
    });

    session.date = d;

    if (exists > 0) {
      session.step = "confirm";
      return bot.sendMessage(msg.chat.id,
`⚠️ ${session.type.toUpperCase()} already exists for ${d}

Overwrite existing questions?`,
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
(you can send multiple messages)

Send /done when finished`);
  }

  /* ---- QUESTIONS STEP ---- */
  if (session.step === "questions" && msg.text && !msg.text.startsWith("/")) {
    session.buffer += "\n\n" + msg.text;
    const count = parseQuestions(session.buffer).length;

    return bot.sendMessage(msg.chat.id,
`📝 Detected questions so far: ${count}`);
  }
});

/* ================= /DONE ================= */

bot.onText(/\/done/, async msg => {
  if (!isOwnerUser(msg.from.id)) return;

  const session = ADMIN.uploads[msg.from.id];
  if (!session) {
    return bot.sendMessage(msg.chat.id, "❌ No active upload session");
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

  ownerLog(
    `${session.type.toUpperCase()} uploaded — ${session.date} (${parsed.length} Q)`
  );

  await bot.sendMessage(msg.chat.id,
`✅ Upload successful

📅 Date: ${session.date}
📝 Questions: ${parsed.length}`);

  delete ADMIN.uploads[msg.from.id];
});


/*************************************************
 * NEET ASPIRANTS BOT — BLOCK 6
 * ANALYTICS + STATUS + MAINTENANCE + MIDNIGHT
 *************************************************/

/* =====================================================
   EXTEND OWNER CALLBACK HANDLER (SAFE)
===================================================== */

const originalOwnerCallbacks_B6 =
  typeof handleOwnerCallbacks === "function"
    ? handleOwnerCallbacks
    : async () => false;

handleOwnerCallbacks = async function (data, chatId, userId) {
  // Let previous blocks handle first
  const handled = await originalOwnerCallbacks_B6(data, chatId, userId);
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
• Accuracy: ${acc} %`,
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

Users temporarily blocked.`,
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

Bot live again.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
};

/* =================================================
   GLOBAL MAINTENANCE GUARD (USER SIDE)
================================================= */

// Wrap startTest safely (only blocks users)
const originalStartTest_B6 =
  typeof startTest === "function" ? startTest : null;

if (originalStartTest_B6) {
  startTest = async function (chatId, userId, type) {
    if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
      return bot.sendMessage(chatId,
`🔧 *Bot Under Maintenance*

Please try again later 🙏`,
        { parse_mode: "Markdown" }
      );
    }
    return originalStartTest_B6(chatId, userId, type);
  };
}

/* =================================================
   MIDNIGHT CRON (DAILY REPORT)
================================================= */

// NOTE: cron is already required in BLOCK-0
cron.schedule("0 0 * * *", async () => {
  try {
    const today = todayDate();
    const attempts = await Attempt.countDocuments({ date: today });

    ownerLog(`🌙 Midnight report: ${attempts} daily attempts today`);
  } catch (err) {
    console.error("❌ Midnight cron error:", err);
  }
});

/* =================================================
   OWNER PANEL BUTTONS (REFERENCE)
================================================= */
// Add these buttons INSIDE OWNER PANEL UI (BLOCK-5)
//
// 📊 Analytics        → ADMIN_ANALYTICS
// 📡 Bot Status       → ADMIN_STATUS
// 🔒 Maintenance ON   → ADMIN_MAINT_ON
// 🔓 Maintenance OFF  → ADMIN_MAINT_OFF
