/*************************************************
 * BLOCK-0
 * NEET ASPIRANTS BOT — FOUNDATION
 * CONFIG • DB • MODELS • GLOBAL STATE
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

if (!BOT_TOKEN || !OWNER_ID || !CHANNEL_USERNAME || !WEBHOOK_URL) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

/* ================= BOT + SERVER ================= */

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB error", err);
    process.exit(1);
  });

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
  practiceWrong: { type: Number, default: 0 },

  ownerMode: { type: Boolean, default: false }
}));

const Question = mongoose.model("Question", new mongoose.Schema({
  date: String,
  type: String, // "daily" | "practice"
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
  console.log("🚀 Bot running (BLOCK-0)");
});

/* ================= HELPERS ================= */

const todayDate = () =>
  new Date().toISOString().split("T")[0];

const isOwnerUser = (id) =>
  id === OWNER_ID;

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

/* ================= GLOBAL STATE ================= */

// 🔹 Active test sessions (daily + practice)
const activeTests = {};     // userId -> test session

// 🔹 Pending force-join actions
const joinPending = {};     // userId -> "daily" | "practice"

// 🔹 Maintenance mode flag
let MAINTENANCE_MODE = false;

/* ================= OWNER LOG SYSTEM ================= */

const OWNER_LOGS = [];

function ownerLog(text) {
  OWNER_LOGS.unshift(`• ${text} (${new Date().toLocaleString()})`);
  if (OWNER_LOGS.length > 20) OWNER_LOGS.pop();

  bot.sendMessage(OWNER_ID, `📜 OWNER LOG\n${text}`).catch(() => {});
}

/*************************************************
 * BLOCK-1
 * /start COMMAND + DAILY LEADERBOARD (BASE)
 * SAFE • NO DUPLICATES • NO OVERRIDES
 *************************************************/

/* ================= /START COMMAND ================= */

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // 🔹 Save user if not exists
    let user = await User.findOne({ user_id: userId });

    if (!user) {
      await User.create({
        user_id: userId,
        username: msg.from.username || "",
        first_name: msg.from.first_name || "",
        joinedAt: new Date()
      });
    }

    // 🔹 Welcome message
    await bot.sendMessage(
      chatId,
`👋 *Welcome to NEET Aspirants Bot*

Designed for serious NEET Biology students.
Daily tests • Practice • Progress tracking

👇 Select an option to continue`,
      { parse_mode: "Markdown" }
    );

    // 🔹 Show today leaderboard
    await showDailyLeaderboard(chatId, todayDate());

    // 🔹 START NOW button
    await bot.sendMessage(
      chatId,
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

  } catch (err) {
    console.error("❌ /start error:", err);
    await bot.sendMessage(chatId, "⚠️ Something went wrong. Try again.");
  }
});

/* ================= DAILY LEADERBOARD ================= */

async function showDailyLeaderboard(chatId, date) {
  try {
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

    let text =
`🏆 *Daily Biology Leaderboard*
📅 ${date}

`;

    if (!rows.length) {
      text += "No attempts yet today.\nBe the first 💪";
    } else {
      rows.forEach((r, i) => {
        const rank =
          i === 0 ? "🥇" :
          i === 1 ? "🥈" :
          i === 2 ? "🥉" :
          `${i + 1}️⃣`;

        text +=
`${rank} Score: ${r.score} / 25
⏱️ Time: ${Math.floor(r.timeTaken / 60)}m ${r.timeTaken % 60}s

`;
      });
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    await bot.sendMessage(chatId, "⚠️ Unable to load leaderboard.");
  }
}

/* =================================================
   BLOCK-2 : MASTER CALLBACK ROUTER (FINAL)
   ⚠️ ONLY ONE CALLBACK LISTENER IN WHOLE PROJECT
================================================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const data = q.data;

  /* ================= SAFETY ================= */
  if (!data) return;

  /* ================= OWNER CALLBACKS ================= */
  if (typeof handleOwnerCallbacks === "function" && isOwnerUser(userId)) {
    const handled = await handleOwnerCallbacks(data, chatId, userId);
    if (handled === true) return;
  }

  /* ================= FORCE JOIN CONFIRM ================= */
  if (data === "check_join") {
    if (await isJoined(userId)) {
      const next = joinPending[userId];
      delete joinPending[userId];
      if (next) {
        return startTest(chatId, userId, next);
      }
    }
    return;
  }

  /* ================= MAIN MENU ================= */
  if (data === "main_menu") {
    return bot.sendMessage(chatId,
`🔥 Let’s improve your NEET score`,
    {
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

  /* ================= DAILY ENTRY ================= */
  if (data === "daily") {
    return startTest(chatId, userId, "daily");
  }

  /* ================= PRACTICE ENTRY ================= */
  if (data === "practice") {
    return startTest(chatId, userId, "practice");
  }

  /* ================= START TEST ================= */
  if (data === "start_now" && activeTests[userId]) {
    const t = activeTests[userId];
    t.startTime = Date.now();

    sendQuestion(chatId, userId);

    setTimeout(() => {
      if (activeTests[userId]) {
        finishTest(chatId, userId, true);
      }
    }, 30 * 60 * 1000);

    return;
  }

  /* ================= ANSWER (ONE CLICK ONLY) ================= */
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
          inline_keyboard: [
            [{ text: "➡️ Next Question", callback_data: "next" }]
          ]
        }
      }
    );
  }

  /* ================= NEXT QUESTION ================= */
  if (data === "next" && activeTests[userId]) {
    const t = activeTests[userId];
    t.index++;

    if (t.index >= 25) {
      return finishTest(chatId, userId, false);
    }

    return sendQuestion(chatId, userId);
  }

  /* ================= PROGRESS ================= */
  if (data === "progress") {
    return showProgress(chatId, userId);
  }
});

/*************************************************
 * BLOCK-3
 * DAILY TEST ENGINE
 * (Logic only — callbacks handled in BLOCK-2)
 *************************************************/

/* ================= DAILY TEST START ================= */

async function startDailyTest(chatId, userId) {
  // Maintenance check (owner always allowed)
  if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
    return bot.sendMessage(chatId,
`🔧 Bot under maintenance.
Please try again later 🙏`);
  }

  // Force join
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "daily");
  }

  const date = todayDate();

  // One attempt per day (owner exempted)
  if (!isOwnerUser(userId)) {
    const already = await Attempt.findOne({ user_id: userId, date });
    if (already) {
      return bot.sendMessage(chatId,
`❌ You already attempted today’s test.
Come back tomorrow 💪`);
    }
  }

  // Fetch questions
  const questions = await Question.find({ date, type: "daily" });
  if (questions.length !== 25) {
    return bot.sendMessage(chatId,
`⏳ Daily test not available yet.`);
  }

  // Create session
  activeTests[userId] = {
    type: "daily",
    date,
    questions,
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

👇 Ready?`,
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
  const left = Math.max(1800 - elapsed, 0);

  const min = Math.floor(left / 60);
  const sec = left % 60;

  bot.sendMessage(chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${min} min ${sec} sec

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

  // Save attempt (owner excluded)
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

📝 Score: ${t.score} / 25`
  : `✅ *Daily Test Completed 🎉*

📝 Score: ${t.score} / 25
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

/*************************************************
 * BLOCK-4
 * PRACTICE TEST ENGINE
 * (Logic only — callbacks in BLOCK-2)
 *************************************************/

/* ================= RANDOM PRACTICE PICKER ================= */

async function getRandomPracticeQuestions() {
  const total = await Question.countDocuments({ type: "practice" });
  if (total < 25) return [];

  const skip = Math.floor(Math.random() * (total - 25 + 1));

  return Question.find({ type: "practice" })
    .skip(skip)
    .limit(25);
}

/* ================= PRACTICE TEST START ================= */

async function startPracticeTest(chatId, userId) {
  // Maintenance check
  if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
    return bot.sendMessage(chatId,
`🔧 Bot under maintenance.
Please try again later 🙏`);
  }

  // Force join
  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "practice");
  }

  // Fetch random questions
  const questions = await getRandomPracticeQuestions();
  if (!questions.length) {
    return bot.sendMessage(chatId,
`⏳ Practice questions not available yet.`);
  }

  // Create session
  activeTests[userId] = {
    type: "practice",
    questions,
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

👇 Ready?`,
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
  const left = Math.max(1800 - elapsed, 0);

  const min = Math.floor(left / 60);
  const sec = left % 60;

  bot.sendMessage(chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${min} min ${sec} sec

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

/* ================= FINISH PRACTICE TEST ================= */

async function finishPracticeTest(chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);
  const correct = t.score;
  const wrong = 25 - correct;
  const accuracy = ((correct / 25) * 100).toFixed(1);

  // Update user stats (owner also allowed)
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
Galat questions ke concepts revise karo`,
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

/*************************************************
 * BLOCK-5
 * OWNER UPLOAD SYSTEM
 * Upload Daily / Practice + Overwrite + /done
 *************************************************/

/* ================= OWNER STATE ================= */

const ADMIN = {
  uploads: {},   // ownerId -> { type, step, date, buffer }
  logs: []
};

function ownerLog(text) {
  ADMIN.logs.unshift(`• ${text} (${new Date().toLocaleString()})`);
  ADMIN.logs = ADMIN.logs.slice(0, 20);
  bot.sendMessage(OWNER_ID, `📜 OWNER LOG\n${text}`).catch(() => {});
}

/* ================= DATE VALIDATION ================= */

function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ================= STRONG QUESTION PARSER ================= */
/*
FORMAT:

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

/* ================= OWNER PANEL ENTRY ================= */

async function showOwnerPanel(chatId) {
  await bot.sendMessage(chatId,
`👑 *OWNER CONTROL PANEL*

Choose an action 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Upload Question Bank", callback_data: "UPLOAD_BANK" }],
          [{ text: "📜 Owner Logs", callback_data: "OWNER_LOGS" }]
        ]
      }
    }
  );
}

/* ================= OWNER CALLBACK HANDLER ================= */

async function handleOwnerCallbacks(data, chatId, userId) {
  if (!isOwnerUser(userId)) return false;

  const session = ADMIN.uploads[userId];

  /* ===== OWNER PANEL ===== */
  if (data === "OWNER_PANEL") {
    await showOwnerPanel(chatId);
    return true;
  }

  /* ===== UPLOAD MENU ===== */
  if (data === "UPLOAD_BANK") {
    await bot.sendMessage(chatId,
`📤 *UPLOAD QUESTION BANK*

Choose upload type 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧬 Upload Daily Test", callback_data: "UPLOAD_DAILY" }],
            [{ text: "🔁 Upload Practice Bank", callback_data: "UPLOAD_PRACTICE" }],
            [{ text: "⬅️ Back", callback_data: "OWNER_PANEL" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== START DAILY UPLOAD ===== */
  if (data === "UPLOAD_DAILY") {
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
`📅 *DAILY TEST UPLOAD*

Send date in format:
YYYY-MM-DD`);
    return true;
  }

  /* ===== START PRACTICE UPLOAD ===== */
  if (data === "UPLOAD_PRACTICE") {
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
`📅 *PRACTICE QUESTION BANK*

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
  if (data === "OWNER_LOGS") {
    const logs = ADMIN.logs.length
      ? ADMIN.logs.join("\n")
      : "No logs yet";

    await bot.sendMessage(chatId,
`📜 *OWNER LOGS*

${logs}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
}

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
`✅ *Upload Successful*

📅 Date: ${session.date}
📝 Questions: ${parsed.length}`,
    { parse_mode: "Markdown" }
  );

  delete ADMIN.uploads[msg.from.id];
});


/*************************************************
 * BLOCK-6
 * ANALYTICS + MAINTENANCE + EMERGENCY CONTROLS
 *************************************************/

/* ================= MAINTENANCE STATE ================= */

let MAINTENANCE_MODE = false;

/* ================= EXTEND OWNER CALLBACK HANDLER ================= */

const _ownerCallbacks_Block6 = handleOwnerCallbacks;

handleOwnerCallbacks = async function (data, chatId, userId) {
  // Pehle BLOCK-5 handle kare
  const handled = await _ownerCallbacks_Block6(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  /* ========== ANALYTICS ========== */
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
    const accuracy = (p.correct + p.wrong)
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
• Accuracy: ${accuracy} %

⚙️ Status: Running`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ========== BOT STATUS ========== */
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

  /* ========== MAINTENANCE ON ========== */
  if (data === "ADMIN_MAINT_ON") {
    MAINTENANCE_MODE = true;
    ownerLog("Maintenance mode ENABLED");

    await bot.sendMessage(chatId,
`🔒 *Maintenance Enabled*

Users temporarily blocked.
Owner access allowed.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ========== MAINTENANCE OFF ========== */
  if (data === "ADMIN_MAINT_OFF") {
    MAINTENANCE_MODE = false;
    ownerLog("Maintenance mode DISABLED");

    await bot.sendMessage(chatId,
`✅ *Maintenance Disabled*

Bot is live again.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ========== FORCE NEW DAY ========== */
  if (data === "ADMIN_FORCE_NEW_DAY") {
    const users = await User.find({});
    let sent = 0;

    for (const u of users) {
      try {
        await bot.sendMessage(
          u.user_id,
          "🧬 New Biology Test is LIVE!\n25 Questions | 30 Minutes\nAll the best 💪"
        );
        sent++;
      } catch {}
    }

    ownerLog(`Force New Day — notified ${sent} users`);

    await bot.sendMessage(chatId,
`🚨 *Force New Day Executed*

📢 Users notified: ${sent}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
};

/* ================= GLOBAL MAINTENANCE GUARD ================= */

const _startTest_Block6 = startTest;

startTest = async function (chatId, userId, type) {
  if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
    return bot.sendMessage(chatId,
`🔧 *Bot Under Maintenance*

Please try again later 🙏`,
      { parse_mode: "Markdown" }
    );
  }

  return _startTest_Block6(chatId, userId, type);
};
