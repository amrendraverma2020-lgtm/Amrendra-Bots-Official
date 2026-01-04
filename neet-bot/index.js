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
  date: String,
  type: String, // daily | practice
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

const todayDate = () => new Date().toISOString().split("T")[0];
const shuffle = arr => arr.sort(() => Math.random() - 0.5);
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
const uploadSession = {};

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

  const startText = `
👋 Welcome to *NEET Aspirants Bot*

🎯 Ye bot specially *NEET Biology* ke serious aspirants ke liye banaya gaya hai.

🧬 *Daily Biology Test*
• 25 MCQs | 30 Minutes
• Rank + Leaderboard

🔁 *Practice Test*
• 25 MCQs | 30 Minutes
• Learning focused

📊 *My Progress*
☎️ *Contact to Owner*

👇 Aage badhne ke liye option choose karein
`;

  await bot.sendMessage(chatId, startText, { parse_mode: "Markdown" });
  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId, "🚀 Get started — choose an option below", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🧬 Today’s Biology Test", callback_data: "daily_test" }],
        [{ text: "🔁 Practice Test", callback_data: "practice_test" }],
        [{ text: "📊 My Progress", callback_data: "progress" }],
        [{ text: "☎️ Contact to Owner", url: SUPPORT_BOT_URL }]
      ]
    }
  });
});

/* ================= FORCE JOIN ================= */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;

  await bot.sendMessage(chatId,
    `🔒 *Channel Join Required*

Pehle hamara official channel join karein  
phir *I have joined* par tap karein.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔔 Join Channel", url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}` }],
          [{ text: "✅ I have joined", callback_data: "check_join" }]
        ]
      }
    }
  );
}

/* ================= LEADERBOARD ================= */

async function showLeaderboard(chatId, date) {
  const list = await Attempt.find({ date }).sort({ score: -1, timeTaken: 1 }).limit(20);
  let text = `🏆 *Biology Leaderboard* (${date})\n\n`;
  if (!list.length) text += "No attempts yet today.";
  else list.forEach((r, i) => {
    text += `${i + 1}. User ${r.user_id} — ${r.score}/25 (${r.timeTaken}s)\n`;
  });
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= TEST ENGINE ================= */

async function startTest(chatId, userId, type) {
  if (!(await isJoined(userId))) return requireJoin(chatId, userId, type);

  const date = todayDate();
  if (type === "daily") {
    const done = await Attempt.findOne({ user_id: userId, date });
    if (done) return bot.sendMessage(chatId, "❌ You have already attempted today’s test.");
  }

  const qs = await Question.find({ date, type });
  if (qs.length < 25) {
    return bot.sendMessage(chatId,
      `⏳ Today’s test will be available soon.\n\nMeanwhile, you can try the Practice Test 💪`
    );
  }

  activeTests[userId] = {
    type,
    date,
    questions: shuffle(qs).slice(0, 25),
    index: 0,
    score: 0,
    startTime: Date.now(),
    answers: []
  };

  bot.sendMessage(chatId, `🧬 Test Started | 25 Questions | 30 Minutes`);
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
    await User.updateOne(
      { user_id: userId },
      { $inc: { totalTests: 1, totalScore: t.score } }
    );
  } else {
    const correct = t.answers.filter(a => a.selected === a.correct).length;
    await User.updateOne(
      { user_id: userId },
      { $inc: { practiceTests: 1, practiceCorrect: correct, practiceWrong: 25 - correct } }
    );
  }

  delete activeTests[userId];

  await bot.sendMessage(chatId,
    `✅ Test Completed\n⭐ Score: ${t.score}/25\n⏱️ Time: ${timeTaken}s`
  );

  for (const a of t.answers) {
    await bot.sendMessage(chatId,
      `${a.selected === a.correct ? "✅ Correct" : "❌ Wrong"}\n✔️ ${a.reason || "No explanation"}`
    );
  }
}

/* ================= OWNER UPLOAD SYSTEM ================= */

bot.onText(/\/upload_daily/, msg => {
  if (!isOwner(msg.from.id)) return;
  uploadSession[msg.from.id] = { type: "daily", step: "date" };
  bot.sendMessage(msg.chat.id, "📅 Send date:\n`Date: YYYY-MM-DD`", { parse_mode: "Markdown" });
});

bot.onText(/\/upload_practice/, msg => {
  if (!isOwner(msg.from.id)) return;
  uploadSession[msg.from.id] = { type: "practice", step: "date" };
  bot.sendMessage(msg.chat.id, "📅 Send date:\n`Date: YYYY-MM-DD`", { parse_mode: "Markdown" });
});

bot.on("message", async msg => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isOwner(userId) || !uploadSession[userId]) return;

  const session = uploadSession[userId];
  const text = msg.text || "";

  if (session.step === "date") {
    const m = text.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    if (!m) return bot.sendMessage(chatId, "❌ Invalid date format.");

    session.date = m[1];
    session.step = "questions";
    return bot.sendMessage(chatId, "✅ Date saved. Now paste all questions together.");
  }

  if (session.step === "questions") {
    const blocks = text.split(/\n\s*\n/);
    let saved = 0;

    for (const b of blocks) {
      const q = b.match(/Q\d*\.?\s*(.+)/s);
      const opts = b.match(/[A-D]\)\s*(.+)/g);
      const ans = b.match(/Ans:\s*([A-D])/i);
      const reason = b.match(/Reason:\s*(.+)/i);

      if (!q || !opts || opts.length !== 4 || !ans) continue;

      await Question.create({
        date: session.date,
        type: session.type,
        q: q[1].trim(),
        options: opts.map(o => o.replace(/[A-D]\)\s*/, "").trim()),
        correct: ["A", "B", "C", "D"].indexOf(ans[1].toUpperCase()),
        reason: reason ? reason[1].trim() : ""
      });

      saved++;
    }

    delete uploadSession[userId];
    return bot.sendMessage(chatId, `✅ Upload successful. Questions saved: ${saved}`);
  }
});

/* ================= CALLBACK ================= */

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
    } else {
      return requireJoin(chatId, userId, joinPending[userId]);
    }
  }

  if (q.data === "daily_test") return startTest(chatId, userId, "daily");
  if (q.data === "practice_test") return startTest(chatId, userId, "practice");
  if (q.data === "progress") return showProgress(chatId, userId);

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
});

/* ================= PROGRESS ================= */

async function showProgress(chatId, userId) {
  if (!(await isJoined(userId))) return requireJoin(chatId, userId, "progress");

  const u = await User.findOne({ user_id: userId });
  const avg = u.totalTests ? (u.totalScore / u.totalTests).toFixed(1) : "0.0";
  const acc = u.practiceTests
    ? ((u.practiceCorrect / (u.practiceCorrect + u.practiceWrong)) * 100).toFixed(1)
    : "0";

  await bot.sendMessage(chatId,
    `📊 *My Progress*

🧬 Tests Attempted: ${u.totalTests}
⭐ Total Score: ${u.totalScore}
📈 Average: ${avg}/25

🔁 Practice Taken: ${u.practiceTests}
🎯 Accuracy: ${acc}%`,
    { parse_mode: "Markdown" }
  );
}

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
