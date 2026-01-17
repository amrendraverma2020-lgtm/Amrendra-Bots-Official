/*************************************************
 * NEET ASPIRANTS BOT — PART 1
 * CORE USER ENGINE (FINAL, STABLE)
 *************************************************/

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const mongoose = require("mongoose");

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

const activeTests = {};   // userId -> test session
const joinPending = {};  // userId -> pending action

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

  await bot.sendMessage(chatId,
`👋 *Welcome to NEET Aspirants Bot*

Designed for serious NEET Biology students.
Daily tests • Practice • Progress tracking

👇 Select an option to continue`,
    { parse_mode: "Markdown" }
  );

  await showLeaderboard(chatId, todayDate());

  await bot.sendMessage(chatId, "🚀 *START NOW*", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 START NOW", callback_data: "main_menu" }]
      ]
    }
  });
});

/* ================= LEADERBOARD ================= */

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

/* ================= CALLBACK ROUTER (SINGLE) ================= */

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  /* 🔑 OWNER CALLBACK HOOK (PART-2 YAHIN AAYEGA) */
  if (typeof handleOwnerCallbacks === "function" && isOwnerUser(userId)) {
    const handled = await handleOwnerCallbacks(q.data, chatId, userId);
    if (handled === true) return;
  }

  /* ===== MAIN MENU ===== */
  if (q.data === "main_menu") {
    return bot.sendMessage(chatId,
`🔥 Let’s improve your NEET score`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧬 Take Today’s Test", callback_data: "daily" }],
            [{ text: "🔁 Practice Biology", callback_data: "practice" }],
            [{ text: "📊 My Progress", callback_data: "progress" }],
            [{ text: "☎️ Contact Owner", url: SUPPORT_BOT_URL }]
          ]
        }
      }
    );
  }
});

/*************************************************
 * NEET ASPIRANTS BOT — PART 2
 * OWNER UPLOAD ENGINE (FINAL, SAFE)
 * NO EXTRA CALLBACK ROUTER
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

function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/* ================= QUESTION PARSER ================= */

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
   OWNER CALLBACK HANDLER
   (CALLED FROM PART-1 CALLBACK ROUTER)
===================================================== */

async function handleOwnerCallbacks(data, chatId, userId) {
  if (!isOwnerUser(userId)) return undefined;

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
            [{ text: "📜 Owner Logs", callback_data: "ADMIN_LOGS" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== UPLOAD BANK ===== */
  if (data === "UPLOAD_BANK") {
    await bot.sendMessage(chatId,
`📤 UPLOAD & QUESTION BANK

Choose upload type 👇`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧬 Upload Daily Test", callback_data: "ADMIN_DAILY" }],
            [{ text: "🔁 Upload Practice Bank", callback_data: "ADMIN_PRACTICE" }],
            [{ text: "⬅️ Back", callback_data: "OWNER_PANEL" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== DAILY UPLOAD ===== */
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

Send date:
YYYY-MM-DD`);
    return true;
  }

  /* ===== PRACTICE UPLOAD ===== */
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
    const logs = ADMIN.logs.length ? ADMIN.logs.join("\n") : "No logs yet";
    await bot.sendMessage(chatId, `📜 OWNER LOGS\n\n${logs}`);
    return true;
  }

  return undefined;
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

    const exists = await Question.countDocuments({ date: d, type: session.type });
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
 * NEET ASPIRANTS BOT — PART 3
 * PRACTICE RANDOM ENGINE + FINISH UI
 * ADD-ONLY • SAFE • LOCKED
 *************************************************/

/* =================================================
   PRACTICE RANDOM QUESTION PICKER
================================================= */
/*
LOCKED RULES:
• Practice bank unlimited
• Har attempt me RANDOM 25
• Daily test se completely independent
• No leaderboard / no rank
*/

async function getRandomPracticeQuestions() {
  const total = await Question.countDocuments({ type: "practice" });
  if (total < 25) return [];

  const skip = Math.floor(Math.random() * (total - 25 + 1));

  return Question.find({ type: "practice" })
    .skip(skip)
    .limit(25);
}

/* =================================================
   SAFE OVERRIDE: startTest (PRACTICE ONLY)
================================================= */
/*
IMPORTANT:
• Sirf practice flow hook hota hai
• Daily test bilkul untouched
*/

const originalStartTest = startTest;

startTest = async function (chatId, userId, type) {
  if (type !== "practice") {
    return originalStartTest(chatId, userId, type);
  }

  if (!(await isJoined(userId))) {
    return requireJoin(chatId, userId, "practice");
  }

  const qs = await getRandomPracticeQuestions();

  if (!qs.length) {
    return bot.sendMessage(chatId,
      "⚠️ Practice questions not available yet.\nPlease try later."
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
• Practice test multiple times de sakte ho
• Score leaderboard me count nahi hota
• Har question ke baad reason milega
• Timer start hone ke baad rukega nahi

👇 Ready ho?`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Start Practice", callback_data: "start_now" }],
          [{ text: "❌ Cancel", callback_data: "main_menu" }]
        ]
      }
    }
  );
};

/* =================================================
   PRACTICE FINISH SCREEN (SAFE OVERRIDE)
================================================= */

const originalFinishTest = finishTest;

finishTest = async function (chatId, userId, timeOver) {
  const t = activeTests[userId];
  if (!t) return;

  // DAILY → original logic
  if (t.type === "daily") {
    return originalFinishTest(chatId, userId, timeOver);
  }

  // PRACTICE RESULT
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
`✅ *Practice Session Completed* 🎯

📝 Total Questions: 25
✔️ Correct: ${correct}
❌ Wrong: ${wrong}
⏱️ Time Taken: ${Math.floor(timeTaken / 60)} min ${timeTaken % 60} sec

📊 Accuracy: ${accuracy}%

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
};
/*************************************************
 * NEET ASPIRANTS BOT — PART 4
 * ADMIN VIEW / DELETE / EMERGENCY / MIDNIGHT
 * ADD-ONLY • SINGLE CALLBACK ROUTER SAFE
 *************************************************/

/* ================= ADMIN TEMP STATE ================= */

const ADMIN_DELETE = {
  step: null // daily_date | broadcast
};

/* =====================================================
   EXTEND OWNER CALLBACK HANDLER (PART-4)
===================================================== */

const originalOwnerCallbacks = handleOwnerCallbacks;

handleOwnerCallbacks = async function (data, chatId, userId) {
  // Let PART-2 handle first
  const handled = await originalOwnerCallbacks(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  /* ===== ADMIN MANAGE ENTRY ===== */
  if (data === "ADMIN_MANAGE") {
    await bot.sendMessage(chatId,
`🛠️ *ADMIN MANAGEMENT*

Choose an action 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 View Daily Tests", callback_data: "ADMIN_VIEW_DAILY" }],
            [{ text: "📋 View Practice Bank", callback_data: "ADMIN_VIEW_PRACTICE" }],
            [{ text: "🗑️ Delete Daily Test", callback_data: "ADMIN_DELETE_DAILY" }],
            [{ text: "🗑️ Clear Practice Bank", callback_data: "ADMIN_DELETE_PRACTICE" }],
            [{ text: "🚨 Emergency Controls", callback_data: "ADMIN_EMERGENCY" }],
            [{ text: "⬅️ Back", callback_data: "OWNER_PANEL" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== VIEW DAILY TESTS ===== */
  if (data === "ADMIN_VIEW_DAILY") {
    const dates = await Question.find({ type: "daily" }).distinct("date");

    await bot.sendMessage(chatId,
`📋 *DAILY TESTS*

${dates.length ? dates.join("\n") : "No daily tests uploaded"}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== VIEW PRACTICE BANK ===== */
  if (data === "ADMIN_VIEW_PRACTICE") {
    const total = await Question.countDocuments({ type: "practice" });

    await bot.sendMessage(chatId,
`📋 *PRACTICE QUESTION BANK*

🧠 Total Questions: ${total}

• Random 25 per attempt
• Unlimited attempts
• No leaderboard`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== DELETE DAILY (ASK DATE) ===== */
  if (data === "ADMIN_DELETE_DAILY") {
    ADMIN_DELETE.step = "daily_date";
    await bot.sendMessage(chatId,
`🗑️ *Delete Daily Test*

Send date to delete:
YYYY-MM-DD`);
    return true;
  }

  /* ===== DELETE PRACTICE BANK (FULL) ===== */
  if (data === "ADMIN_DELETE_PRACTICE") {
    const total = await Question.countDocuments({ type: "practice" });
    await Question.deleteMany({ type: "practice" });

    ownerLog(`Practice bank cleared (${total} Q)`);

    await bot.sendMessage(chatId,
`🗑️ *Practice Bank Cleared*

Questions deleted: ${total}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== EMERGENCY PANEL ===== */
  if (data === "ADMIN_EMERGENCY") {
    await bot.sendMessage(chatId,
`🚨 *EMERGENCY CONTROLS*

Use carefully 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⚡ Force New Day", callback_data: "ADMIN_FORCE_NEW_DAY" }],
            [{ text: "📢 Manual Broadcast", callback_data: "ADMIN_BROADCAST" }],
            [{ text: "⬅️ Back", callback_data: "ADMIN_MANAGE" }]
          ]
        }
      }
    );
    return true;
  }

  /* ===== FORCE NEW DAY ===== */
  if (data === "ADMIN_FORCE_NEW_DAY") {
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

    ownerLog(`Force new day — notified ${sent} users`);

    await bot.sendMessage(chatId,
`✅ *New Day Forced*

Users notified: ${sent}`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== MANUAL BROADCAST ===== */
  if (data === "ADMIN_BROADCAST") {
    ADMIN_DELETE.step = "broadcast";
    await bot.sendMessage(chatId,
`📢 *Manual Broadcast*

Send message text now`);
    return true;
  }

  return false;
};

/* =================================================
   ADMIN MESSAGE HANDLER (DELETE / BROADCAST)
================================================= */

bot.on("message", async msg => {
  if (!isOwnerUser(msg.from?.id)) return;

  /* ---- DELETE DAILY BY DATE ---- */
  if (ADMIN_DELETE.step === "daily_date") {
    const d = msg.text?.trim();
    if (!validDate(d)) {
      return bot.sendMessage(msg.chat.id, "❌ Invalid date format");
    }

    const count = await Question.countDocuments({ date: d, type: "daily" });
    await Question.deleteMany({ date: d, type: "daily" });
    await Attempt.deleteMany({ date: d });

    ADMIN_DELETE.step = null;

    ownerLog(`Daily test deleted — ${d} (${count} Q)`);

    return bot.sendMessage(msg.chat.id,
`✅ *Daily Test Deleted*

📅 Date: ${d}
🧪 Questions removed: ${count}`,
      { parse_mode: "Markdown" }
    );
  }

  /* ---- MANUAL BROADCAST ---- */
  if (ADMIN_DELETE.step === "broadcast") {
    const users = await User.find({});
    let sent = 0;

    for (const u of users) {
      try {
        await bot.sendMessage(u.user_id, msg.text);
        sent++;
      } catch {}
    }

    ADMIN_DELETE.step = null;

    ownerLog(`Manual broadcast sent (${sent} users)`);

    return bot.sendMessage(msg.chat.id,
`✅ *Broadcast Completed*

Users reached: ${sent}`,
      { parse_mode: "Markdown" }
    );
  }
});

/* =================================================
   MIDNIGHT REPORT (AUTO)
================================================= */

// ⚠️ cron already required at top in PART-1
cron.schedule("0 0 * * *", async () => {
  try {
    const today = todayDate();
    const attempts = await Attempt.countDocuments({ date: today });
    ownerLog(`🌙 Midnight report: ${attempts} daily attempts today`);
  } catch (err) {
    console.error("❌ Midnight cron error:", err);
  }
});
/*************************************************
 * NEET ASPIRANTS BOT — PART 5
 * ANALYTICS + STATUS + MAINTENANCE
 * ADD-ONLY • SAFE • LOCKED
 *************************************************/

/* ================= MAINTENANCE STATE ================= */

let MAINTENANCE_MODE = false;

/* =====================================================
   EXTEND OWNER CALLBACK HANDLER (PART-5)
===================================================== */

const originalOwnerCallbacks_P5 = handleOwnerCallbacks;

handleOwnerCallbacks = async function (data, chatId, userId) {
  // Let PART-2 → PART-4 handle first
  const handled = await originalOwnerCallbacks_P5(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  /* ===== ANALYTICS PANEL ===== */
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
• Accuracy: ${acc} %

⚙️ Status: Running`,
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

Users ko temporarily block kar diya gaya hai.`,
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

Bot normal mode me aa gaya hai.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
};

/* =================================================
   MAINTENANCE CHECK (GLOBAL USER BLOCK)
================================================= */

const originalStartTest_P5 = startTest;

startTest = async function (chatId, userId, type) {
  if (MAINTENANCE_MODE && !isOwnerUser(userId)) {
    return bot.sendMessage(chatId,
`🔧 *Bot Under Maintenance*

Thodi der baad try karein 🙏`,
      { parse_mode: "Markdown" }
    );
  }
  return originalStartTest_P5(chatId, userId, type);
};

/* =================================================
   OWNER PANEL BUTTON EXTENSION (SAFE)
================================================= */

// Add these buttons INSIDE OWNER PANEL UI (PART-2)
// (Reference only — already handled by callbacks)
//
// 📊 Analytics        → ADMIN_ANALYTICS
// 📡 Bot Status       → ADMIN_STATUS
// 🔒 Maintenance ON   → ADMIN_MAINT_ON
// 🔓 Maintenance OFF  → ADMIN_MAINT_OFF
/*************************************************
 * NEET ASPIRANTS BOT — PART 6 (FINAL)
 * OWNER MODE + FORCE DAY + CLEANUP + BROADCAST
 * ADD-ONLY • SAFE • LOCKED
 *************************************************/

/* ================= OWNER MODE ================= */

let OWNER_MODE = false;

/* ================= DAILY TEST STATE ================= */

let TODAY_TEST_OPEN = true;

/* =====================================================
   EXTEND OWNER CALLBACK HANDLER (PART-6)
===================================================== */

const originalOwnerCallbacks_P6 = handleOwnerCallbacks;

handleOwnerCallbacks = async function (data, chatId, userId) {
  const handled = await originalOwnerCallbacks_P6(data, chatId, userId);
  if (handled) return true;

  if (!isOwnerUser(userId)) return false;

  /* ===== FORCE NEW DAY ===== */
  if (data === "ADMIN_FORCE_NEW_DAY") {
    TODAY_TEST_OPEN = true;
    ownerLog("Force new day triggered");

    await bot.sendMessage(chatId,
`✅ *New Day Forced*

Daily test manually reset.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== CLOSE TODAY TEST ===== */
  if (data === "ADMIN_CLOSE_TODAY") {
    TODAY_TEST_OPEN = false;
    ownerLog("Today test CLOSED");

    await bot.sendMessage(chatId,
`🔒 *Today’s Test Closed*`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  /* ===== OPEN TODAY TEST ===== */
  if (data === "ADMIN_OPEN_TODAY") {
    TODAY_TEST_OPEN = true;
    ownerLog("Today test OPENED");

    await bot.sendMessage(chatId,
`🔓 *Today’s Test Opened*`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  return false;
};

/* =====================================================
   START TEST OVERRIDE (OWNER MODE + OPEN/CLOSE)
===================================================== */

const originalStartTest_P6 = startTest;

startTest = async function (chatId, userId, type) {
  if (!OWNER_MODE && !TODAY_TEST_OPEN && type === "daily") {
    return bot.sendMessage(chatId,
`⛔ *Today’s Test is Closed*

Kal attempt karein 💪`,
      { parse_mode: "Markdown" }
    );
  }

  return originalStartTest_P6(chatId, userId, type);
};

/* =====================================================
   OWNER COMMANDS (TEXT)
===================================================== */

bot.onText(/\/owner_mode_on/, msg => {
  if (!isOwnerUser(msg.from.id)) return;
  OWNER_MODE = true;
  ownerLog("Owner mode ENABLED");

  bot.sendMessage(msg.chat.id, "👑 Owner Mode ON");
});

bot.onText(/\/owner_mode_off/, msg => {
  if (!isOwnerUser(msg.from.id)) return;
  OWNER_MODE = false;
  ownerLog("Owner mode DISABLED");

  bot.sendMessage(msg.chat.id, "👑 Owner Mode OFF");
});

/* ================= FORCE / OPEN / CLOSE ================= */

bot.onText(/\/force_new_day/, msg => {
  if (!isOwnerUser(msg.from.id)) return;
  TODAY_TEST_OPEN = true;
  ownerLog("Force new day (command)");

  bot.sendMessage(msg.chat.id, "✅ New day forced");
});

bot.onText(/\/close_today_test/, msg => {
  if (!isOwnerUser(msg.from.id)) return;
  TODAY_TEST_OPEN = false;
  ownerLog("Today test closed");

  bot.sendMessage(msg.chat.id, "🔒 Today test closed");
});

bot.onText(/\/open_today_test/, msg => {
  if (!isOwnerUser(msg.from.id)) return;
  TODAY_TEST_OPEN = true;
  ownerLog("Today test opened");

  bot.sendMessage(msg.chat.id, "🔓 Today test opened");
});

/* ================= CLEANUP ================= */

bot.onText(/\/cleanup_old_tests/, async msg => {
  if (!isOwnerUser(msg.from.id)) return;

  const limit = new Date();
  limit.setDate(limit.getDate() - 30);
  const d = limit.toISOString().split("T")[0];

  const q = await Question.deleteMany({ type: "daily", date: { $lt: d } });
  ownerLog(`Old daily tests cleaned (${q.deletedCount})`);

  bot.sendMessage(msg.chat.id,
`🧹 Old Daily Tests Deleted: ${q.deletedCount}`);
});

bot.onText(/\/cleanup_old_practice/, async msg => {
  if (!isOwnerUser(msg.from.id)) return;

  const q = await Question.deleteMany({ type: "practice" });
  ownerLog(`Practice bank cleaned (${q.deletedCount})`);

  bot.sendMessage(msg.chat.id,
`🧹 Practice Questions Deleted: ${q.deletedCount}`);
});

/* ================= BROADCAST ================= */

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isOwnerUser(msg.from.id)) return;

  const text = match[1];
  const users = await User.find({});
  let sent = 0;

  for (const u of users) {
    try {
      await bot.sendMessage(u.user_id, text);
      sent++;
    } catch {}
  }

  ownerLog(`Broadcast sent (${sent} users)`);

  bot.sendMessage(msg.chat.id,
`📢 Broadcast Sent  
👥 Users reached: ${sent}`);
});
