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

  const welcomeText = `
👋 *Welcome to NEET Aspirants Bot*

🎯 Ye bot specially *NEET Biology* ke serious aspirants ke liye hai  
jahan aap daily tests aur practice ke through  
apni preparation ko strong bana sakte ho.

━━━━━━━━━━━━━━━
🧬 *Daily Biology Test*
• 25 MCQs
• ⏱️ 30 Minutes
• 🏆 Rank + Daily Leaderboard
• Sirf *1 attempt per day*

━━━━━━━━━━━━━━━
🔁 *Practice Test*
• 25 MCQs
• ⏱️ 30 Minutes
• 📚 Learning focused
• ❌ No rank, ❌ no pressure

━━━━━━━━━━━━━━━
📊 *My Progress*
• Tests + practice ka complete analysis

☎️ *Contact to Owner*
• Feature request ya help ke liye
`;

  await bot.sendMessage(chatId, welcomeText, { parse_mode: "Markdown" });
  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId,
    "━━━━━━━━━━━━━━━\n🔥 Ready to test your preparation?\n👇 Tap below to get started",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Start Now", callback_data: "start_menu" }]
        ]
      }
    }
  );
});

/* ================= FORCE JOIN ================= */

async function requireJoin(chatId, userId, action) {
  joinPending[userId] = action;
  await bot.sendMessage(chatId,
`🔒 *Channel Join Required*

Is bot ke saare features use karne ke liye
pehle hamara official channel join karo.

👇 Join karke *I have joined* dabao`,
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
  const list = await Attempt.find({ date })
    .sort({ score: -1, timeTaken: 1 })
    .limit(20);

  let text = `🏆 *Daily Biology Leaderboard*\n📅 Date: ${date}\n\n`;

  if (!list.length) {
    text += "No attempts yet today.\nBe the first one 💪";
  } else {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const user = await User.findOne({ user_id: r.user_id });

      const name =
        user?.username ? `@${user.username}` :
        user?.first_name ? user.first_name :
        "NEET Aspirant";

      const medal =
        i === 0 ? "🥇 1st" :
        i === 1 ? "🥈 2nd" :
        i === 2 ? "🥉 3rd" :
        `🔹 ${i+1}th`;

      const min = Math.floor(r.timeTaken / 60);
      const sec = r.timeTaken % 60;

      text += `${medal} *${name}*\n⭐ Score: ${r.score}/25\n⏱️ Time: ${min}m ${sec}s\n\n`;
    }
  }

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ================= TIMER HELP ================= */

function remainingMinutes(t) {
  const total = 30 * 60;
  const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
  return Math.max(Math.ceil((total - elapsed) / 60), 0);
}

/* ================= TEST ENGINE ================= */

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
      "⏳ Today’s test will be available soon.\n\nMeanwhile, try Practice Test 💪"
    );
  }

  activeTests[userId] = {
    type,
    date,
    questions: qs.slice(0,25),
    index: 0,
    score: 0,
    startTime: null
  };

  const instructionText = type === "daily"
    ? `🧬 *Daily Biology Test*

📝 Total Questions: 25
⏱️ Time Limit: 30 Minutes

⚠️ Sirf 1 attempt allowed
🏆 Rank + Leaderboard count hoga

👇 Ready? Start below`
    : `🔁 *Biology Practice Session*

📝 Total Questions: 25
⏱️ Time Limit: 30 Minutes

📚 Learning focused
❌ No rank, ❌ no pressure

👇 Ready? Start practice`;

  await bot.sendMessage(chatId, instructionText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: type === "daily" ? "▶️ Start Test" : "▶️ Start Practice", callback_data: "start_now" }],
        [{ text: "❌ Cancel", callback_data: "cancel_test" }]
      ]
    }
  });
}

/* ================= QUESTION UI ================= */

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  const q = t.questions[t.index];

  const text =
`🧬 *Question ${t.index + 1} / 25*
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

/* ================= CALLBACK HANDLER ================= */

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  if (q.data === "start_menu") {
    return bot.sendMessage(chatId,
      "Choose what you want to do 👇",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧬 Today’s Biology Test", callback_data: "daily_test" }],
            [{ text: "🔁 Practice Test", callback_data: "practice_test" }],
            [{ text: "📊 My Progress", callback_data: "progress" }],
            [{ text: "☎️ Contact to Owner", url: SUPPORT_BOT_URL }]
          ]
        }
      }
    );
  }

  if (q.data === "daily_test") return startTest(chatId, userId, "daily");
  if (q.data === "practice_test") return startTest(chatId, userId, "practice");

  if (q.data === "start_now") {
    const t = activeTests[userId];
    t.startTime = Date.now();
    sendQuestion(chatId, userId);

    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId);
    }, 30 * 60 * 1000);
  }

  if (q.data.startsWith("ans_")) {
    const t = activeTests[userId];
    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];
    const correct = sel === cq.correct;

    if (correct) t.score++;

    await bot.sendMessage(chatId,
      correct
        ? `✅ *Correct!*\n\n✔️ ${cq.reason}`
        : `❌ *Wrong!*\n\n✅ Correct Answer: *${["🅐","🅑","🅒","🅓"][cq.correct]}*\n✔️ ${cq.reason}`,
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
    t.index++;
    if (t.index >= 25) return finishTest(chatId, userId);
    sendQuestion(chatId, userId);
  }
});

/* ================= FINISH TEST ================= */

async function finishTest(chatId, userId) {
  const t = activeTests[userId];
  const time = Math.floor((Date.now() - t.startTime) / 1000);

  let rankText = "";

  if (t.type === "daily") {
    await Attempt.create({ user_id: userId, date: t.date, score: t.score, timeTaken: time });
    await User.updateOne({ user_id: userId }, { $inc: { totalTests: 1, totalScore: t.score } });

    const all = await Attempt.find({ date: t.date }).sort({ score: -1, timeTaken: 1 });
    const rank = all.findIndex(a => a.user_id === userId) + 1;
    rankText = `🏆 Rank: ${rank} / ${all.length}\n`;
  }

  delete activeTests[userId];

  const min = Math.floor(time / 60);
  const sec = time % 60;

  const resultText = t.type === "daily"
    ? `✅ *Daily Test Completed* 🎉

📝 Total Questions: 25
⭐ Score: ${t.score} / 25
⏱️ Time Taken: ${min} min ${sec} sec
${rankText}
📊 Result leaderboard me count ho gaya
💪 Apni rank improve karne ke liye daily attempt karein`
    : `✅ *Practice Session Completed* 👍

📝 Questions Attempted: 25
✔️ Correct Answers: ${t.score}
❌ Wrong Answers: ${25 - t.score}
⏱️ Time Taken: ${min} min ${sec} sec

📚 Learning > Score
💪 Roz practice se accuracy improve hogi`;

  await bot.sendMessage(chatId, resultText, { parse_mode: "Markdown" });
}

/* ================= CLEANUP ================= */

cron.schedule("0 0 * * *", async () => {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  const cutoff = d.toISOString().split("T")[0];
  await Question.deleteMany({ date: { $lt: cutoff } });
  await Attempt.deleteMany({ date: { $lt: cutoff } });
});
