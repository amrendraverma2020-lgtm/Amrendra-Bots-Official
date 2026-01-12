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
/*************************************************
 * NEET ASPIRANTS BOT — PART 2
 * OWNER / ADMIN FINAL MODULE
 * (UPLOAD + MANAGE + LOGS)
 *************************************************/

/* ===============================
   OWNER HELPERS (NAMESPACE SAFE)
================================ */

const ADMIN = {
  uploads: {},     // uploadSessions
  logs: []         // owner action logs
};

  return id === OWNER_ID;
}

function ownerLog(text) {
  ADMIN.logs.unshift(`• ${text} (${new Date().toLocaleString()})`);
  ADMIN.logs = ADMIN.logs.slice(0, 20);
  bot.sendMessage(OWNER_ID, `📜 OWNER LOG\n${text}`).catch(()=>{});
}

function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ===============================
   OWNER PANEL (BUTTON UI)
================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "owner_panel") {
    return bot.sendMessage(q.message.chat.id,
`👑 *OWNER CONTROL PANEL*

Choose a section 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📤 Upload Daily Test", callback_data: "admin_upload_daily" }],
            [{ text: "🔁 Upload Practice Bank", callback_data: "admin_upload_practice" }],
            [{ text: "📅 View / Manage Tests", callback_data: "admin_manage_tests" }],
            [{ text: "📊 Bot Analytics", callback_data: "admin_analytics" }],
            [{ text: "⚙️ Emergency Controls", callback_data: "admin_emergency" }]
          ]
        }
      }
    );
  }
});

/* ===============================
   START DAILY UPLOAD
================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_upload_daily") {
    ADMIN.uploads[OWNER_ID] = {
      type: "daily",
      step: "date",
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

/* ===============================
   START PRACTICE UPLOAD
================================ */

bot.on("callback_query", async q => {
  if (!isOwnerUser(q.from.id)) return;

  if (q.data === "admin_upload_practice") {
    ADMIN.uploads[OWNER_ID] = {
      type: "practice",
      step: "date",
      buffer: ""
    };

    ownerLog("Started PRACTICE upload");

    return bot.sendMessage(OWNER_ID,
`📅 *Practice Question Bank*

Send date (used only for grouping):
YYYY-MM-DD`,
      { parse_mode: "Markdown" }
    );
  }
});

/* ===============================
   STRONG QUESTION PARSER
================================ */

function parseQuestionBlock(raw) {
  const blocks = raw
    .split(/(?:\n\s*---+\s*\n)|(?:\n{2,})/)
    .map(b => b.trim())
    .filter(Boolean);

  const out = [];

  for (const b of blocks) {
    const qMatch = b.match(/Q\d*\.?\s*(.+)/i);
    const opts = [...b.matchAll(/^[A-D]\)\s*(.+)$/gm)];
    const ans = b.match(/Ans:\s*([A-D])/i);
    const reason = b.match(/Reason:\s*(.+)/i);

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

/* ===============================
   OWNER MESSAGE HANDLER
================================ */

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;
  const session = ADMIN.uploads[OWNER_ID];
  if (!session) return;

  /* DATE STEP */
  if (session.step === "date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(OWNER_ID, "❌ Invalid date format");
    }

    const exists = await Question.countDocuments({ date: d, type: session.type });
    session.date = d;

    if (exists > 0) {
      session.step = "confirm";
      return bot.sendMessage(OWNER_ID,
`⚠️ ${session.type.toUpperCase()} already exists for ${d}

Overwrite?`,
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
Send /done when finished`);
  }

  /* QUESTIONS STEP */
  if (session.step === "questions" && msg.text && !msg.text.startsWith("/")) {
    session.buffer += "\n" + msg.text;
    const parsed = parseQuestionBlock(session.buffer);

    return bot.sendMessage(OWNER_ID,
`📝 Detected questions so far: ${parsed.length}`);
  }
});

/* ===============================
   OVERWRITE CONFIRMATION
================================ */

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
      "📝 Old data deleted. Paste new questions now.\nSend /done when finished");
  }
});

/* ===============================
   /DONE FINALIZATION
================================ */

bot.onText(/\/done/, async msg => {
  if (!isOwnerUser(msg.from.id)) return;
  const session = ADMIN.uploads[OWNER_ID];
  if (!session) {
    return bot.sendMessage(OWNER_ID, "❌ No active upload session");
  }

  const parsed = parseQuestionBlock(session.buffer);

  if (session.type === "daily" && parsed.length !== 25) {
    return bot.sendMessage(OWNER_ID,
      `❌ Daily test must have EXACTLY 25 questions\nDetected: ${parsed.length}`);
  }

  if (parsed.length < 1) {
    return bot.sendMessage(OWNER_ID, "❌ No valid questions found");
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

/* ===============================
   MIDNIGHT AUTO TEST + REPORT
================================ */

cron.schedule("0 0 * * *", async () => {
  const users = await User.find({});
  let sent = 0;

  for (const u of users) {
    try {
      await bot.sendMessage(u.user_id,
        "🧬 New Biology Test is LIVE!\n25 Questions | 30 Minutes\nAll the best 💪"
      );
      sent++;
    } catch {}
  }

  ownerLog(`Midnight test alert sent to ${sent} users`);
});

/*************************************************
 * NEET ASPIRANTS BOT — PART 3
 * ADMIN ANALYTICS + VIEW / DELETE (BUTTON UI)
 * OWNER ONLY • ADD-ONLY MODULE
 *************************************************/

/* ===============================================
   ADMIN MENU (BUTTON BASED)
================================================ */

bot.onText(/\/admin_panel/, async msg => {
  if (msg.from.id !== OWNER_ID) return;

  await bot.sendMessage(msg.chat.id,
`👑 *OWNER CONTROL PANEL*

Choose a section below 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📊 Analytics", callback_data: "admin_analytics" }],
          [{ text: "📋 View Tests", callback_data: "admin_view_tests" }],
          [{ text: "🗑️ Delete Tests", callback_data: "admin_delete_tests" }],
          [{ text: "⚙️ Daily Control", callback_data: "admin_daily_control" }],
          [{ text: "📜 Owner Logs", callback_data: "admin_logs" }]
        ]
      }
    }
  );
});

/* ===============================================
   CALLBACK HANDLER — ADMIN
================================================ */

bot.on("callback_query", async q => {
  const id = q.from.id;
  if (id !== OWNER_ID) return;

  /* ---------- ANALYTICS ---------- */
  if (q.data === "admin_analytics") {
    const totalUsers = await User.countDocuments();
    const today = todayDate();

    const todayAttempts = await Attempt.countDocuments({ date: today });
    const avgScoreAgg = await Attempt.aggregate([
      { $match: { date: today } },
      { $group: { _id: null, avg: { $avg: "$score" } } }
    ]);

    const avgScore = avgScoreAgg[0]?.avg?.toFixed(1) || "0.0";

    await bot.sendMessage(id,
`📊 *BOT ANALYTICS*

👥 Total Users: ${totalUsers}
🧪 Attempts Today: ${todayAttempts}
⭐ Avg Score Today: ${avgScore} / 25

⏱️ Server: Online
🗄️ DB: Connected`,
      { parse_mode: "Markdown" }
    );

    notifyOwner("📊 Admin viewed analytics");
  }

  /* ---------- VIEW TESTS ---------- */
  if (q.data === "admin_view_tests") {
    const dates = await Question.find({ type: "daily" }).distinct("date");

    if (!dates.length) {
      return bot.sendMessage(id, "❌ No daily tests found.");
    }

    const buttons = dates.map(d => ([
      { text: `📅 ${d}`, callback_data: `view_test_${d}` }
    ]));

    await bot.sendMessage(id,
`📋 *Daily Tests Available*`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }

  if (q.data.startsWith("view_test_")) {
    const date = q.data.replace("view_test_", "");
    const qs = await Question.find({ date, type: "daily" });

    if (!qs.length) {
      return bot.sendMessage(id, "❌ No test found for this date.");
    }

    let text = `🧬 *Daily Test — ${date}*\n\n`;

    qs.forEach((q, i) => {
      text +=
`Q${i + 1}. ${q.q}
🅐 ${q.options[0]}
🅑 ${q.options[1]}
🅒 ${q.options[2]}
🅓 ${q.options[3]}
✅ Ans: ${["A","B","C","D"][q.correct]}

`;
    });

    await bot.sendMessage(id, text.slice(0, 3900), { parse_mode: "Markdown" });
    notifyOwner(`📋 Viewed test: ${date}`);
  }

  /* ---------- DELETE TESTS ---------- */
  if (q.data === "admin_delete_tests") {
    const dates = await Question.find({ type: "daily" }).distinct("date");

    if (!dates.length) {
      return bot.sendMessage(id, "❌ No daily tests to delete.");
    }

    const buttons = dates.map(d => ([
      { text: `🗑️ ${d}`, callback_data: `confirm_delete_${d}` }
    ]));

    await bot.sendMessage(id,
`⚠️ *Delete Daily Test*`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }

  if (q.data.startsWith("confirm_delete_")) {
    const date = q.data.replace("confirm_delete_", "");

    await bot.sendMessage(id,
`⚠️ Are you sure you want to delete test for *${date}*?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ YES, DELETE", callback_data: `delete_yes_${date}` }],
            [{ text: "❌ Cancel", callback_data: "admin_panel" }]
          ]
        }
      }
    );
  }

  if (q.data.startsWith("delete_yes_")) {
    const date = q.data.replace("delete_yes_", "");

    await Question.deleteMany({ date, type: "daily" });
    await Attempt.deleteMany({ date });

    await bot.sendMessage(id, `✅ Test deleted for ${date}`);
    notifyOwner(`🗑️ Deleted daily test: ${date}`);
  }

  /* ---------- DAILY CONTROL ---------- */
  if (q.data === "admin_daily_control") {
    await bot.sendMessage(id,
`⚙️ *Daily Control*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚨 Force New Day", callback_data: "force_new_day_now" }],
            [{ text: "📢 Notify Users", callback_data: "notify_users" }]
          ]
        }
      }
    );
  }

  if (q.data === "force_new_day_now") {
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

    notifyOwner(`🚨 Force new day triggered\n📢 Users notified: ${sent}`);
    await bot.sendMessage(id, `✅ New day forced\n📢 Notified users: ${sent}`);
  }

  /* ---------- OWNER LOG ---------- */
  if (q.data === "admin_logs") {
    await bot.sendMessage(id,
`📜 *OWNER LOG*

• Upload / delete
• Force new day
• Analytics access

(Logs auto-sent in DM as well)`,
      { parse_mode: "Markdown" }
    );
  }
});
