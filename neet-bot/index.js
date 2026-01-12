/*************************************************
 * NEET ASPIRANTS BOT — PART 1
 * CORE USER ENGINE (FINAL, LOCKED)
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

/* ================= STATE ================= */

const activeTests = {}; // userId -> session
const joinPending = {}; // userId -> action

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
    { $group: {
        _id: "$user_id",
        score: { $first: "$score" },
        timeTaken: { $first: "$timeTaken" }
    }},
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
  const total = 25 * 60; // 25 min = 25 questions
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

  const intro =
`🧬 *${type === "daily" ? "Daily Biology Test" : "Practice Biology"}*

📝 Total Questions: 25
⏱️ Time Limit: 25 Minutes

👇 Ready?`;

  await bot.sendMessage(chatId, intro, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ Start", callback_data: "start_now" }],
        [{ text: "❌ Cancel", callback_data: "cancel" }]
      ]
    }
  });
}

/* ================= SEND QUESTION ================= */

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];
  const time = remainingTime(t);

  const text =
`🧬 *Question ${t.index + 1} / 25*
⏱️ Time Left: ${time.min} min ${time.sec} sec

${q.q}

🅐 ${q.options[0]}        🅑 ${q.options[1]}
🅒 ${q.options[2]}        🅓 ${q.options[3]}`;

  t.answered = false;

  bot.sendMessage(chatId, text, {
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
  });
}

/* ================= CALLBACKS ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const t = activeTests[userId];

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
  }

  if (q.data.startsWith("ans_")) {
    if (!t || t.answered) return;

    t.answered = true;
    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];

    const correct = sel === cq.correct;
    if (correct) t.score++;

    await bot.sendMessage(chatId,
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
    sendQuestion(chatId, userId);
  }

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

  const result =
timeOver
? `⏰ *Time Over! Test Auto-Submitted*

⭐ Score: ${t.score} / 25
⏱️ Time: 25 minutes`
: `✅ *Test Completed* 🎉

⭐ Score: ${t.score} / 25
⏱️ Time: ${Math.floor(timeTaken/60)} min ${timeTaken%60} sec`;

  await bot.sendMessage(chatId, result, { parse_mode: "Markdown" });

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
• Accuracy: ${u.practiceCorrect + u.practiceWrong
    ? ((u.practiceCorrect / (u.practiceCorrect + u.practiceWrong)) * 100).toFixed(1)
    : 0}%

💡 Keep going 💪`,
    { parse_mode: "Markdown" }
  );
}
