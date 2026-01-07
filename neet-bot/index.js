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
  console.log("🚀 Bot running on webhook");
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

const activeTests = {};
const joinPending = {};

/* ================= START ================= */

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

  await bot.sendMessage(chatId,
`👋 *Welcome to NEET Aspirants Bot*

🧬 *Daily Biology Test*
• 25 MCQs | 30 Minutes
• Rank + Leaderboard

🔁 *Practice Test*
• 25 MCQs | 30 Minutes
• Learning focused

📊 *My Progress*
☎️ *Contact to Owner*`,
{ parse_mode: "Markdown" });

  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId,
    "━━━━━━━━━━━━━━━\n🔥 Ready to test your preparation?",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "🚀 Start Now", callback_data: "start_menu" }]]
      }
    }
  );
});

/* ================= LEADERBOARD ================= */

async function showLeaderboard(chatId, date) {
  const list = await Attempt.find({ date })
    .sort({ score: -1, timeTaken: 1 })
    .limit(20);

  let text = `🏆 *Daily Biology Leaderboard*\n📅 ${date}\n\n`;

  if (!list.length) {
    text += "No attempts yet today.";
  } else {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const u = await User.findOne({ user_id: r.user_id });
      const name = u?.username ? `@${u.username}` : u?.first_name || "Aspirant";
      const min = Math.floor(r.timeTaken / 60);
      const sec = r.timeTaken % 60;

      text += `${i+1}. *${name}*\n⭐ ${r.score}/25 | ⏱️ ${min}m ${sec}s\n\n`;
    }
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= TEST ENGINE ================= */

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) return;

  const date = todayDate();

  if (type === "daily" && !isOwner(userId)) {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) return;
  }

  const qs = await Question.find({ date, type });
  if (!qs.length) {
    return bot.sendMessage(chatId,
      "⏳ Today’s test will be available soon.\nMeanwhile try Practice 💪");
  }

  activeTests[userId] = {
    type,
    date,
    questions: qs.slice(0,25),
    index: 0,
    score: 0,
    startTime: null
  };

  await bot.sendMessage(chatId,
`🧬 *${type === "daily" ? "Daily Test" : "Practice Session"}*

📝 25 Questions
⏱️ 30 Minutes

👇 Start when ready`,
{
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [{ text: "▶️ Start", callback_data: "start_now" }],
      [{ text: "❌ Cancel", callback_data: "cancel_test" }]
    ]
  }
});
}

function remainingMinutes(t) {
  const total = 30 * 60;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  return Math.max(Math.ceil((total - elapsed) / 60), 0);
}

/* ================= QUESTION ================= */

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const q = t.questions[t.index];

  bot.sendMessage(chatId,
`🧬 *Question ${t.index + 1} / 25*
⏱️ *Time Left: ${remainingMinutes(t)} min*

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
      [{ text: `🅐 ${q.options[0]}`, callback_data: "ans_0" }],
      [{ text: `🅑 ${q.options[1]}`, callback_data: "ans_1" }],
      [{ text: `🅒 ${q.options[2]}`, callback_data: "ans_2" }],
      [{ text: `🅓 ${q.options[3]}`, callback_data: "ans_3" }]
    ]
  }
});
}

/* ================= CALLBACKS (CRASH-PROOF) ================= */

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  if (q.data === "start_menu") {
    return bot.sendMessage(chatId, "Choose 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧬 Daily Test", callback_data: "daily_test" }],
          [{ text: "🔁 Practice", callback_data: "practice_test" }],
          [{ text: "📊 My Progress", callback_data: "progress" }],
          [{ text: "☎️ Contact Owner", url: SUPPORT_BOT_URL }]
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
    if (!t) return; // 🔒 SILENT FIX

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
    if (!t) return; // 🔒 SILENT FIX

    t.index++;
    if (t.index >= t.questions.length) {
      return finishTest(chatId, userId);
    }
    sendQuestion(chatId, userId);
  }

  if (q.data === "progress") return showProgress(chatId, userId);
});

/* ================= FINISH TEST ================= */

async function finishTest(chatId, userId) {
  const t = activeTests[userId];
  if (!t) return;

  const time = Math.floor((Date.now() - t.startTime) / 1000);
  const min = Math.floor(time / 60);
  const sec = time % 60;

  let rankText = "";

  if (t.type === "daily") {
    await Attempt.create({ user_id: userId, date: t.date, score: t.score, timeTaken: time });
    await User.updateOne({ user_id: userId }, { $inc: { totalTests: 1, totalScore: t.score } });

    const all = await Attempt.find({ date: t.date }).sort({ score: -1, timeTaken: 1 });
    rankText = `🏆 Rank: ${all.findIndex(a => a.user_id === userId) + 1}/${all.length}\n`;
  }

  delete activeTests[userId];

  await bot.sendMessage(chatId,
t.type === "daily"
? `✅ *Daily Test Completed*

📝 25 Questions
⭐ Score: ${t.score}/25
⏱️ Time: ${min}m ${sec}s
${rankText}`
: `✅ *Practice Completed*

✔️ Correct: ${t.score}
❌ Wrong: ${25 - t.score}
⏱️ Time: ${min}m ${sec}s`,
{ parse_mode: "Markdown" });
}

/* ================= PROGRESS (FIXED) ================= */

async function showProgress(chatId, userId) {
  const u = await User.findOne({ user_id: userId });

  const avg = u.totalTests
    ? (u.totalScore / u.totalTests).toFixed(1)
    : 0;

  await bot.sendMessage(chatId,
`📊 *My Progress*

🧬 Daily Tests:
• Attempts: ${u.totalTests}
• Total Score: ${u.totalScore}
• Avg Score: ${avg}/25

🔁 Practice:
• Sessions: ${u.practiceTests}
• Correct: ${u.practiceCorrect}
• Wrong: ${u.practiceWrong}

💪 Keep practicing daily`,
{ parse_mode: "Markdown" });
}

/* ================= CLEANUP ================= */

cron.schedule("0 0 * * *", async () => {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  const cutoff = d.toISOString().split("T")[0];
  await Question.deleteMany({ date: { $lt: cutoff } });
  await Attempt.deleteMany({ date: { $lt: cutoff } });
});
