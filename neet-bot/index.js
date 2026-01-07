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

  const text = `
👋 *Welcome to NEET Aspirants Bot*

🧬 *Daily Biology Test*
• 25 MCQs | 30 Minutes
• Rank + Leaderboard

🔁 *Practice Test*
• 25 MCQs | 30 Minutes
• Learning focused

📊 *My Progress*
☎️ *Contact to Owner*
`;

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
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
    questions: shuffle(qs).slice(0,25),
    index: 0,
    score: 0,
    startTime: null,
    answers: []
  };

  await bot.sendMessage(chatId,
`🧬 *Biology Test Instructions*

📝 Total Questions: 25
⏱️ Time Limit: 30 Minutes
📌 Test Type: ${type === "daily" ? "Daily Test" : "Practice Test"}

⚠️ Once started, test cannot be paused.

👇 Ready? Start below`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start Test", callback_data: "start_now" }],
          [{ text: "❌ Cancel", callback_data: "cancel_test" }]
        ]
      }
    }
  );
}

function sendQuestion(chatId, userId) {
  const t = activeTests[userId];
  const q = t.questions[t.index];

  const text =
`🧬 *Question ${t.index + 1} / 25*

${q.q}

A️⃣ ${q.options[0]}
B️⃣ ${q.options[1]}
C️⃣ ${q.options[2]}
D️⃣ ${q.options[3]}

📌 Choose the correct option 👇`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "A️⃣", callback_data: "ans_0" }],
        [{ text: "B️⃣", callback_data: "ans_1" }],
        [{ text: "C️⃣", callback_data: "ans_2" }],
        [{ text: "D️⃣", callback_data: "ans_3" }]
      ]
    }
  });
}

async function finishTest(chatId, userId) {
  const t = activeTests[userId];
  const time = Math.floor((Date.now() - t.startTime) / 1000);

  if (t.type === "daily") {
    await Attempt.create({ user_id: userId, date: t.date, score: t.score, timeTaken: time });
    await User.updateOne(
      { user_id: userId },
      { $inc: { totalTests: 1, totalScore: t.score } }
    );
  }

  delete activeTests[userId];

  const min = Math.floor(time / 60);
  const sec = time % 60;

  await bot.sendMessage(chatId,
`✅ *Test Completed Successfully* 🎉

📝 Total Questions: 25
⭐ Score: ${t.score} / 25
⏱️ Time Taken: ${min} min ${sec} sec

💪 Keep practicing daily to improve your rank`,
    { parse_mode: "Markdown" }
  );
}

/* ================= OWNER UPLOAD ================= */

bot.onText(/\/upload_daily/, msg => {
  if (!isOwner(msg.from.id)) return;
  uploadSession[msg.from.id] = { type: "daily", step: "date" };
  bot.sendMessage(msg.chat.id, "Send date:\nDate: YYYY-MM-DD");
});

bot.onText(/\/upload_practice/, msg => {
  if (!isOwner(msg.from.id)) return;
  uploadSession[msg.from.id] = { type: "practice", step: "date" };
  bot.sendMessage(msg.chat.id, "Send date:\nDate: YYYY-MM-DD");
});

bot.on("message", async msg => {
  const userId = msg.from.id;
  if (!isOwner(userId) || !uploadSession[userId]) return;

  const session = uploadSession[userId];
  const text = msg.text || "";

  if (session.step === "date") {
    const m = text.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    if (!m) return bot.sendMessage(msg.chat.id, "❌ Invalid date format");
    session.date = m[1];
    session.step = "questions";
    return bot.sendMessage(msg.chat.id, "✅ Date saved. Now paste questions.");
  }

  if (session.step === "questions") {
    const blocks = text.split(/(?=Q\d+\.)/g);
    let saved = 0;

    for (const b of blocks) {
      const q = b.match(/Q\d+\.\s*([\s\S]*?)A\)/);
      const opts = b.match(/[A-D]\)\s*(.+)/g);
      const ans = b.match(/Ans:\s*([A-D])/i);
      const reason = b.match(/Reason:\s*([\s\S]+)/i);

      if (!q || !opts || opts.length < 4 || !ans) continue;

      await Question.create({
        date: session.date,
        type: session.type,
        q: q[1].trim(),
        options: opts.slice(0,4).map(o => o.replace(/[A-D]\)\s*/, "").trim()),
        correct: ["A","B","C","D"].indexOf(ans[1].toUpperCase()),
        reason: reason ? reason[1].trim() : ""
      });

      saved++;
    }

    delete uploadSession[userId];
    return bot.sendMessage(msg.chat.id, `✅ Upload successful. Questions saved: ${saved}`);
  }
});

/* ================= CALLBACKS ================= */

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
    }
  }

  if (q.data === "daily_test") return startTest(chatId, userId, "daily");
  if (q.data === "practice_test") return startTest(chatId, userId, "practice");
  if (q.data === "progress") return showProgress(chatId, userId);

  if (q.data === "start_now") {
    const t = activeTests[userId];
    if (!t) return;
    t.startTime = Date.now();
    sendQuestion(chatId, userId);
    setTimeout(() => {
      if (activeTests[userId]) finishTest(chatId, userId);
    }, 30 * 60 * 1000);
  }

  if (q.data === "cancel_test") {
    delete activeTests[userId];
    return bot.sendMessage(chatId, "❌ Test cancelled.");
  }

  if (q.data.startsWith("ans_")) {
    const t = activeTests[userId];
    if (!t) return;

    const sel = Number(q.data.split("_")[1]);
    const cq = t.questions[t.index];
    const isCorrect = sel === cq.correct;
    if (isCorrect) t.score++;

    let feedback = isCorrect
      ? `✅ *Correct!*\n\n✔️ ${cq.reason || "Good job!"}`
      : `❌ *Wrong!*\n\n✅ Correct Answer: *${["A","B","C","D"][cq.correct]}*\n✔️ ${cq.reason || ""}`;

    await bot.sendMessage(chatId, feedback, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "➡️ Next Question", callback_data: "next_q" }]]
      }
    });
  }

  if (q.data === "next_q") {
    const t = activeTests[userId];
    if (!t) return;
    t.index++;
    if (t.index >= t.questions.length) return finishTest(chatId, userId);
    sendQuestion(chatId, userId);
  }
});

/* ================= PROGRESS ================= */

async function showProgress(chatId, userId) {
  const u = await User.findOne({ user_id: userId });
  await bot.sendMessage(chatId,
`📊 *My Progress*

🧬 Tests Attempted: ${u.totalTests}
⭐ Total Score: ${u.totalScore}

💪 Keep practicing daily`,
    { parse_mode: "Markdown" }
  );
}

/* ================= CLEANUP ================= */

cron.schedule("0 0 * * *", async () => {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  const cutoff = d.toISOString().split("T")[0];
  await Question.deleteMany({ date: { $lt: cutoff } });
  await Attempt.deleteMany({ date: { $lt: cutoff } });
});
