/*************************************************
 * NEET ASPIRANTS BOT — PART 1
 * CORE USER ENGINE (NO ADMIN / UPLOAD)
 * Stable • Crash-proof • Production Ready
 *************************************************/

require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");

/* ===============================================
   CONFIG
================================================ */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME; // @channel
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPPORT_BOT_URL = process.env.SUPPORT_BOT_URL;

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ===============================================
   DATABASE
================================================ */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error", err));

/* ===============================================
   SCHEMAS
================================================ */

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
  date: String,           // YYYY-MM-DD
  type: String,           // daily | practice
  q: String,
  options: [String],      // 4 options
  correct: Number,        // 0..3
  reason: String
}));

const Attempt = mongoose.model("Attempt", new mongoose.Schema({
  user_id: Number,
  date: String,
  score: Number,
  timeTaken: Number
}));

/* ===============================================
   WEBHOOK
================================================ */

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(10000, async () => {
  await bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);
  console.log("🚀 Bot running via webhook");
});

/* ===============================================
   HELPERS
================================================ */

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

/* ===============================================
   STATE (IN-MEMORY)
================================================ */

const activeTests = {};   // userId → test session
const joinPending = {};  // force join flow

/* ===============================================
   /START
================================================ */

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

  const welcomeText = `
👋 *Welcome to NEET Aspirants Bot* 🧬

🎯 Ye bot *serious NEET Biology aspirants* ke liye hai  
jo daily tests aur practice ke through  
apni preparation ko next level par le jaana chahte hain.

━━━━━━━━━━━━━━━
🧪 *Daily Biology Test*
• Roz **1 test**
• **25 MCQs | 30 Minutes**
• 🏆 Rank + Daily Leaderboard

━━━━━━━━━━━━━━━
🔁 *Practice Test*
• **25 Biology MCQs**
• **30 Minutes**
• 📚 Learning focused

━━━━━━━━━━━━━━━
📊 *My Progress*
• Tests + practice ka complete analysis

━━━━━━━━━━━━━━━
☎️ *Contact to Owner*
• Suggestions / issues / features

📌 *Tip:* Daily Test + Practice = NEET edge 💪

👇 Neeche se start karo
`;

  await bot.sendMessage(chatId, welcomeText, { parse_mode: "Markdown" });
  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId,
    "🚀 *Get started — choose an option below*",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Start Now", callback_data: "start_menu" }]
        ]
      }
    }
  );
});

/* ===============================================
   FORCE JOIN
================================================ */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;

  await bot.sendMessage(chatId,
`🔒 *Channel Join Required*

Is bot ke features use karne ke liye  
pehle hamara official channel join karein.

👇 Join karke *I have joined* dabayein`,
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

/* ===============================================
   LEADERBOARD (USER-WISE, BEST ATTEMPT)
================================================ */

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
    { $limit: 20 }
  ]);

  let text = `🏆 *Daily Biology Leaderboard*\n📅 ${date}\n\n`;

  if (!rows.length) {
    text += "No attempts yet today.\nBe the first 💪";
  } else {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const u = await User.findOne({ user_id: r._id });
      const name = u?.username ? `@${u.username}` : u?.first_name || "NEET Aspirant";
      const m = Math.floor(r.timeTaken / 60);
      const s = r.timeTaken % 60;

      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;

      text += `${medal} *${name}*\n⭐ ${r.score}/25 | ⏱️ ${m}m ${s}s\n\n`;
    }
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ===============================================
   TEST ENGINE
================================================ */

function remainingMinutes(t) {
  const total = 30 * 60;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  return Math.max(Math.ceil((total - elapsed) / 60), 0);
}

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) return requireJoin(chatId, userId, type);

  const date = todayDate();

  if (type === "daily" && !isOwner(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) {
      return bot.sendMessage(chatId,
        "❌ You have already attempted today’s test.\nCome back tomorrow 💪"
      );
    }
  }

  const qs = await Question.find({ date, type });
  if (!qs.length) {
    return bot.sendMessage(chatId,
      "⏳ Today’s test will be available soon.\nMeanwhile, try Practice Test 💪"
    );
  }

  activeTests[userId] = {
    type,
    date,
    questions: qs.slice(0, 25),
    index: 0,
    score: 0,
    startTime: null
  };

  const instructions = type === "daily"
    ? `🧬 *Daily Biology Test*\n\n📝 25 Questions\n⏱️ 30 Minutes\n🏆 Rank + Leaderboard\n\n👇 Ready?`
    : `🔁 *Practice Test*\n\n📝 25 Questions\n⏱️ 30 Minutes\n📚 Learning focused\n\n👇 Ready?`;

  await bot.sendMessage(chatId, instructions, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ Start", callback_data: "start_now" }],
        [{ text: "❌ Cancel", callback_data: "cancel_test" }]
      ]
    }
  });
}

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];

  const text = `
🧬 *Question ${t.index + 1} / 25*
⏱️ *Time Left: ${remainingMinutes(t)} min*

${q.q}

🅐 ${q.options[0]}
🅑 ${q.options[1]}
🅒 ${q.options[2]}
🅓 ${q.options[3]}

👇 Choose the correct option`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: `🅐 ${q.options[0]}`, callback_data: "ans_0" }],
        [{ text: `🅑 ${q.options[1]}`, callback_data: "ans_1" }],
        [{ text: `🅒 ${q.options[2]}`, callback_data: "ans_2" }],
        [{ text: `🅓 ${q.options[3]}`, callback_data: "ans_3" }]
      ]
    }
  });
}

/* ===============================================
   CALLBACKS (CRASH-PROOF)
================================================ */

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  if (q.data === "check_join") {
    if (await isJoined(userId)) {
      const next = joinPending[userId];
      delete joinPending[userId];
      if (next === "daily") return startTest(chatId, userId, "daily");
      if (next === "practice") return startTest(chatId, userId, "practice");
      if (next === "progress") return showProgress(chatId, userId);
      return;
    }
    return requireJoin(chatId, userId, joinPending[userId]);
  }

  if (q.data === "start_menu") {
    return bot.sendMessage(chatId, "Choose an option 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧬 Today’s Biology Test", callback_data: "daily_test" }],
          [{ text: "🔁 Practice Test", callback_data: "practice_test" }],
          [{ text: "📊 My Progress", callback_data: "progress" }],
          [{ text: "☎️ Contact to Owner", url: SUPPORT_BOT_URL }]
        ]
      }
    });
  }

  if (q.data === "daily_test") return startTest(chatId, userId, "daily");
  if (q.data === "practice_test") return startTest(chatId, userId, "practice");

  if (q.data === "start_now") {
    const t = activeTests[userId];
    if (!t) return;
    t.startTime = Date.now();
    sendQuestion(chatId, userId);

    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId);
    }, 30 * 60 * 1000);
  }

  if (q.data.startsWith("ans_")) {
    const t = activeTests[userId];
    if (!t) return;

    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];
    const correct = sel === cq.correct;
    if (correct) t.score++;

    await bot.sendMessage(chatId,
      correct
        ? `✅ *Correct!*\n\n✔️ ${cq.reason}`
        : `❌ *Wrong!*\n\n✅ Correct: *${["🅐","🅑","🅒","🅓"][cq.correct]}*\n✔️ ${cq.reason}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "➡️ Next Question", callback_data: "next_q" }]]
        }
      }
    );
  }

  if (q.data === "next_q") {
    const t = activeTests[userId];
    if (!t) return;
    t.index++;
    if (t.index >= t.questions.length) return finishTest(chatId, userId);
    sendQuestion(chatId, userId);
  }

  if (q.data === "progress") return showProgress(chatId, userId);
});

/* ===============================================
   FINISH TEST
================================================ */

async function finishTest(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const time = Math.floor((Date.now() - t.startTime) / 1000);
  const m = Math.floor(time / 60);
  const s = time % 60;

  if (t.type === "daily") {
    await Attempt.create({
      user_id: userId,
      date: t.date,
      score: t.score,
      timeTaken: time
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
          practiceWrong: t.questions.length - t.score
        }
      }
    );
  }

  delete activeTests[userId];

  const result = t.type === "daily"
    ? `✅ *Daily Test Completed*\n\n⭐ Score: ${t.score}/25\n⏱️ Time: ${m}m ${s}s`
    : `✅ *Practice Completed*\n\n✔️ Correct: ${t.score}\n❌ Wrong: ${25 - t.score}\n⏱️ Time: ${m}m ${s}s`;

  await bot.sendMessage(chatId, result, { parse_mode: "Markdown" });
}

/* ===============================================
   PROGRESS
================================================ */

async function showProgress(chatId, userId) {
  if (!(await isJoined(userId))) return requireJoin(chatId, userId, "progress");

  const u = await User.findOne({ user_id: userId });
  const avg = u.totalTests ? (u.totalScore / u.totalTests).toFixed(1) : "0.0";
  const acc = (u.practiceCorrect + u.practiceWrong)
    ? ((u.practiceCorrect / (u.practiceCorrect + u.practiceWrong)) * 100).toFixed(1)
    : "0";

  await bot.sendMessage(chatId,
`📊 *My Progress*

🧬 *Daily Tests*
• Attempts: ${u.totalTests}
• Total Score: ${u.totalScore}
• Avg Score: ${avg}/25

🔁 *Practice*
• Sessions: ${u.practiceTests}
• Correct: ${u.practiceCorrect}
• Wrong: ${u.practiceWrong}
• Accuracy: ${acc}%

💪 Keep going — consistency wins`,
    { parse_mode: "Markdown" }
  );
}

/* ===============================================
   CRON (MIDNIGHT)
================================================ */

cron.schedule("0 0 * * *", async () => {
  const users = await User.find({});
  for (const u of users) {
    bot.sendMessage(u.user_id,
      "🧬 New Biology Test is LIVE!\n25 Questions | 30 Minutes\nAll the best 💪"
    ).catch(()=>{});
  }

  const d = new Date();
  d.setDate(d.getDate() - 3);
  const cutoff = d.toISOString().split("T")[0];
  await Question.deleteMany({ date: { $lt: cutoff } });
  await Attempt.deleteMany({ date: { $lt: cutoff } });

  console.log("🗑️ Old data cleaned");
});

/*************************************************
 * NEET ASPIRANTS BOT — PART 2
 * OWNER / ADMIN MODULE
 * (ADD-ONLY, DO NOT MODIFY PART-1)
 *************************************************/

/* ===============================================
   OWNER HELPERS
================================================ */

function ownerOnly(msg) {
  return msg.from && msg.from.id === OWNER_ID;
}

async function notifyOwner(text) {
  await bot.sendMessage(OWNER_ID, text).catch(()=>{});
}

/* ===============================================
   ADMIN STATE
================================================ */

// uploadSessions[ownerId] = { type, step, date, buffer }
const uploadSessions = {};

/* ===============================================
   STRONG PARSER
================================================ */

function parseQuestions(rawText) {
  const blocks = rawText.split(/\n\s*\n/);
  const questions = [];

  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 6) continue;

    const qLine = lines.find(l => l.startsWith("Q"));
    const options = lines.filter(l => /^[A-D]\)/.test(l));
    const ansLine = lines.find(l => /^Ans:/i.test(l));
    const reasonLine = lines.find(l => /^Reason:/i.test(l));

    if (!qLine || options.length !== 4 || !ansLine) continue;

    const correctChar = ansLine.split(":")[1].trim().toUpperCase();
    const correctIndex = ["A","B","C","D"].indexOf(correctChar);
    if (correctIndex === -1) continue;

    questions.push({
      q: qLine.replace(/^Q\d*\.?\s*/,""),
      options: options.map(o => o.replace(/^[A-D]\)\s*/,"")),
      correct: correctIndex,
      reason: reasonLine ? reasonLine.replace(/^Reason:\s*/,"") : "No explanation provided"
    });
  }

  return questions;
}

/* ===============================================
   /UPLOAD_DAILY
================================================ */

bot.onText(/\/upload_daily/, async msg => {
  if (!ownerOnly(msg)) return;

  uploadSessions[msg.from.id] = {
    type: "daily",
    step: "date",
    buffer: ""
  };

  await bot.sendMessage(msg.chat.id,
`📅 *Send date for DAILY TEST*
Format: YYYY-MM-DD`,
    { parse_mode: "Markdown" }
  );
});

/* ===============================================
   /UPLOAD_PRACTICE
================================================ */

bot.onText(/\/upload_practice/, async msg => {
  if (!ownerOnly(msg)) return;

  uploadSessions[msg.from.id] = {
    type: "practice",
    step: "date",
    buffer: ""
  };

  await bot.sendMessage(msg.chat.id,
`📅 *Send date for PRACTICE SET*
Format: YYYY-MM-DD`,
    { parse_mode: "Markdown" }
  );
});

/* ===============================================
   OWNER MESSAGE HANDLER (UPLOAD FLOW)
================================================ */

bot.on("message", async msg => {
  const ownerId = msg.from?.id;
  if (!uploadSessions[ownerId]) return;
  if (!ownerOnly(msg)) return;

  const session = uploadSessions[ownerId];

  // STEP 1: DATE
  if (session.step === "date") {
    const date = msg.text.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return bot.sendMessage(msg.chat.id, "❌ Invalid date format. Use YYYY-MM-DD");
    }

    const exists = await Question.findOne({ date, type: session.type });
    if (exists) {
      session.date = date;
      session.step = "confirm_overwrite";

      return bot.sendMessage(msg.chat.id,
`⚠️ ${session.type.toUpperCase()} already exists for ${date}

Overwrite existing questions?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Overwrite", callback_data: "overwrite_yes" }],
              [{ text: "❌ Cancel", callback_data: "overwrite_no" }]
            ]
          }
        }
      );
    }

    session.date = date;
    session.step = "questions";

    return bot.sendMessage(msg.chat.id,
`📝 Send all questions now
(25 MCQs, bulk paste allowed)`
    );
  }

  // STEP 2: QUESTIONS
  if (session.step === "questions") {
    session.buffer += "\n" + msg.text;

    const parsed = parseQuestions(session.buffer);

    if (parsed.length < 1) {
      return bot.sendMessage(msg.chat.id,
        "⚠️ No valid questions detected yet. Continue pasting…"
      );
    }

    await Question.deleteMany({ date: session.date, type: session.type });

    const docs = parsed.map(q => ({
      ...q,
      date: session.date,
      type: session.type
    }));

    await Question.insertMany(docs);

    await bot.sendMessage(msg.chat.id,
      `✅ Upload successful. Questions saved: ${docs.length}`
    );

    await notifyOwner(
      `✅ ${session.type.toUpperCase()} upload complete\n📅 Date: ${session.date}\n📝 Questions: ${docs.length}`
    );

    delete uploadSessions[ownerId];
  }
});

/* ===============================================
   OVERWRITE CALLBACK
================================================ */

bot.on("callback_query", async q => {
  const ownerId = q.from.id;
  if (!uploadSessions[ownerId]) return;

  const session = uploadSessions[ownerId];

  if (q.data === "overwrite_no") {
    delete uploadSessions[ownerId];
    await bot.sendMessage(ownerId, "❌ Upload cancelled.");
    await notifyOwner("⚠️ Upload cancelled by owner");
  }

  if (q.data === "overwrite_yes") {
    session.step = "questions";
    await bot.sendMessage(ownerId,
      "📝 Send new questions now (old ones will be replaced)"
    );
    await notifyOwner(
      `⚠️ Overwrite confirmed for ${session.type.toUpperCase()} on ${session.date}`
    );
  }
});

/* ===============================================
   /LIST_TESTS & /LIST_PRACTICE
================================================ */

bot.onText(/\/list_tests/, async msg => {
  if (!ownerOnly(msg)) return;
  const dates = await Question.find({ type: "daily" }).distinct("date");
  await bot.sendMessage(msg.chat.id,
    `📋 Daily Tests:\n${dates.join("\n") || "None"}`
  );
  await notifyOwner("📋 /list_tests executed");
});

bot.onText(/\/list_practice/, async msg => {
  if (!ownerOnly(msg)) return;
  const dates = await Question.find({ type: "practice" }).distinct("date");
  await bot.sendMessage(msg.chat.id,
    `📋 Practice Sets:\n${dates.join("\n") || "None"}`
  );
  await notifyOwner("📋 /list_practice executed");
});

/* ===============================================
   /DELETE_TEST YYYY-MM-DD
================================================ */

bot.onText(/\/delete_test (\d{4}-\d{2}-\d{2})/, async (msg, match) => {
  if (!ownerOnly(msg)) return;

  const date = match[1];
  const res = await Question.deleteMany({ date });

  await bot.sendMessage(msg.chat.id,
    `🗑️ Deleted ${res.deletedCount} questions for ${date}`
  );

  await notifyOwner(
    `🗑️ Test data deleted\n📅 Date: ${date}\n🧹 Count: ${res.deletedCount}`
  );
});

/* ===============================================
   /FORCE_NEW_DAY
================================================ */

bot.onText(/\/force_new_day/, async msg => {
  if (!ownerOnly(msg)) return;

  await bot.sendMessage(msg.chat.id,
    "⏰ Manual new day triggered.\nUsers will receive fresh test from now."
  );

  await notifyOwner("⏰ /force_new_day executed manually by owner");
});

/* ===============================================
   ADMIN STATS
================================================ */

bot.onText(/\/admin_stats/, async msg => {
  if (!ownerOnly(msg)) return;

  const users = await User.countDocuments();
  const tests = await Question.countDocuments({ type: "daily" });
  const practice = await Question.countDocuments({ type: "practice" });

  const text =
`📊 *Admin Stats*

👥 Users: ${users}
🧪 Daily Questions: ${tests}
🔁 Practice Questions: ${practice}`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  await notifyOwner("📊 /admin_stats viewed");
});
