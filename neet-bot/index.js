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

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ================= DB ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ Mongo error", err));

/* ================= SCHEMAS ================= */

const userSchema = new mongoose.Schema({
  user_id: Number,
  username: String,
  first_name: String,
  joinedAt: Date,

  totalTests: { type: Number, default: 0 },
  totalScore: { type: Number, default: 0 },

  practiceTests: { type: Number, default: 0 },
  practiceCorrect: { type: Number, default: 0 },
  practiceWrong: { type: Number, default: 0 }
});

const questionSchema = new mongoose.Schema({
  date: String,            // YYYY-MM-DD
  type: String,            // daily | practice
  q: String,
  options: [String],
  correct: Number,
  reason: String
});

const attemptSchema = new mongoose.Schema({
  user_id: Number,
  date: String,
  score: Number,
  timeTaken: Number
});

const User = mongoose.model("User", userSchema);
const Question = mongoose.model("Question", questionSchema);
const Attempt = mongoose.model("Attempt", attemptSchema);

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

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

async function isJoined(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

/* ================= START ================= */

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
👋 Welcome to *NEET Aspirants Bot*

🧬 *Daily Biology Test*
• 25 Questions
• 30 Minutes
• Rank + Leaderboard

🔁 *Practice Test*
• 25 Questions
• 30 Minutes
• Learning focused

📊 *My Progress*
☎️ *Contact to Owner*

👇 Use buttons below
`;

  await bot.sendMessage(chatId, welcome, { parse_mode: "Markdown" });
  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId, "Menu:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🧬 Today’s Biology Test", callback_data: "daily_test" }],
        [{ text: "🔁 Practice Test", callback_data: "practice_test" }],
        [{ text: "📊 My Progress", callback_data: "progress" }],
        [{ text: "☎️ Contact to Owner", callback_data: "contact" }]
      ]
    }
  });
});

/* ================= LEADERBOARD ================= */

async function getLeaderboard(date) {
  return Attempt.find({ date }).sort({ score: -1, timeTaken: 1 }).limit(20);
}

async function showLeaderboard(chatId, date) {
  const list = await getLeaderboard(date);
  let text = `🏆 *Biology Leaderboard* (${date})\n\n`;

  if (!list.length) text += "No attempts yet.\n";
  else {
    list.forEach((r, i) => {
      text += `${i + 1}. User ${r.user_id} — ${r.score}/25 (${r.timeTaken}s)\n`;
    });
  }
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= OWNER UPLOAD ================= */

let uploadSession = {};
const isOwner = id => id === OWNER_ID;

bot.onText(/\/upload_daily/, msg => {
  if (!isOwner(msg.from.id)) return;
  uploadSession[msg.from.id] = { type: "daily", step: "date" };
  bot.sendMessage(msg.chat.id, "📅 Send date:\nDate: YYYY-MM-DD");
});

bot.onText(/\/upload_practice/, msg => {
  if (!isOwner(msg.from.id)) return;
  uploadSession[msg.from.id] = { type: "practice", step: "date" };
  bot.sendMessage(msg.chat.id, "📅 Send date:\nDate: YYYY-MM-DD");
});

/* ================= TEST ENGINE ================= */

const activeTests = {};

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) {
    return bot.sendMessage(chatId, "🔒 Join channel first.");
  }

  const date = todayDate();

  if (type === "daily") {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) return bot.sendMessage(chatId, "❌ Already attempted today.");
  }

  const questions = await Question.find({ date, type });
  if (questions.length < 25) {
    return bot.sendMessage(chatId, "⚠️ Test not available yet.");
  }

  activeTests[userId] = {
    type,
    date,
    questions: shuffle(questions).slice(0, 25),
    index: 0,
    score: 0,
    startTime: Date.now(),
    answers: []
  };

  bot.sendMessage(chatId,
    `🧬 ${type === "daily" ? "Daily Test" : "Practice Test"} Started\n⏱️ 30 Minutes`
  );

  sendQuestion(chatId, userId);

  setTimeout(() => {
    if (activeTests[userId]) finishTest(chatId, userId);
  }, 30 * 60 * 1000);
}

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  const q = t.questions[t.index];

  bot.sendMessage(chatId,
    `Q${t.index + 1}. ${q.q}`,
    {
      reply_markup: {
        inline_keyboard: q.options.map((o, i) => [
          { text: o, callback_data: `ans_${i}` }
        ])
      }
    }
  );
}

async function finishTest(chatId, userId) {
  const t = activeTests[userId];
  const timeTaken = Math.floor((Date.now() - t.startTime) / 1000);

  if (t.type === "daily") {
    await Attempt.create({ user_id: userId, date: t.date, score: t.score, timeTaken });
    await User.updateOne({ user_id: userId }, { $inc: { totalTests: 1, totalScore: t.score } });
  } else {
    const correct = t.answers.filter(a => a.correct === a.selected).length;
    await User.updateOne(
      { user_id: userId },
      { $inc: { practiceTests: 1, practiceCorrect: correct, practiceWrong: 25 - correct } }
    );
  }

  delete activeTests[userId];

  await bot.sendMessage(chatId,
    `✅ Test Completed\nScore: ${t.score}/25\nTime: ${timeTaken}s`
  );

  for (const a of t.answers) {
    await bot.sendMessage(chatId,
      `${a.selected === a.correct ? "✅ Correct" : "❌ Wrong"}\n✔️ ${a.reason || "No explanation"}`
    );
  }
}

/* ================= CALLBACK ================= */

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  if (q.data === "daily_test") return startTest(chatId, userId, "daily");
  if (q.data === "practice_test") return startTest(chatId, userId, "practice");

  if (q.data.startsWith("ans_")) {
    const t = activeTests[userId];
    if (!t) return;
    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];

    if (sel === cq.correct) t.score++;
    t.answers.push({ selected: sel, correct: cq.correct, reason: cq.reason });
    t.index++;

    if (t.index >= 25) finishTest(chatId, userId);
    else sendQuestion(chatId, userId);
  }

  if (q.data === "progress") {
    const u = await User.findOne({ user_id: userId });
    return bot.sendMessage(chatId,
      `📊 Progress\nTests: ${u.totalTests}\nScore: ${u.totalScore}\nPractice: ${u.practiceTests}`
    );
  }

  if (q.data === "contact") {
    return bot.sendMessage(chatId, "Contact owner via support bot.");
  }
});

/* ================= MIDNIGHT JOB ================= */

cron.schedule("0 0 * * *", async () => {
  const users = await User.find({});
  for (const u of users) {
    bot.sendMessage(u.user_id,
      "🧬 New Biology Test is LIVE!\n25 Questions | 30 Minutes"
    );
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const d = cutoff.toISOString().split("T")[0];

  await Question.deleteMany({ date: { $lt: d } });
  await Attempt.deleteMany({ date: { $lt: d } });

  console.log("🗑️ Old data cleaned");
});
