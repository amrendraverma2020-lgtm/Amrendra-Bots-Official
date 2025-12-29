const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const FORCE_CHANNEL = process.env.FORCE_CHANNEL; // without @
const SUPPORT_BOT = process.env.SUPPORT_BOT || "amrendra_support_bot";
const OWNER_ID = process.env.OWNER_ID; // numeric telegram id
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !FORCE_CHANNEL || !OWNER_ID) {
  throw new Error("Missing required environment variables");
}

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Study Resource Hub bot is running");
});

// ===== TELEGRAM HELPER =====
async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ===== FORCE JOIN CHECK (OWNER BYPASS FIX) =====
async function isJoined(userId) {
  // Owner bypass
  if (String(userId) === String(OWNER_ID)) {
    return true;
  }

  const res = await tg("getChatMember", {
    chat_id: `@${FORCE_CHANNEL}`,
    user_id: userId,
  });

  const data = await res.json();
  if (!data.ok) return false;

  return ["member", "administrator", "creator"].includes(
    data.result.status
  );
}

// ===== KEYBOARDS =====
const JOIN_MENU = {
  inline_keyboard: [
    [{ text: "🔔 Join Channel", url: `https://t.me/${FORCE_CHANNEL}` }],
    [
      {
        text: "📩 Contact to Owner",
        url: `https://t.me/${SUPPORT_BOT}?start=join_issue`
      }
    ],
    [{ text: "✅ I've Joined", callback_data: "check_join" }],
  ],
};

const MAIN_MENU = {
  inline_keyboard: [
    [{ text: "📘 PDFs", callback_data: "pdfs" }],
    [{ text: "📚 Notes", callback_data: "notes" }],
    [{ text: "📝 Exam Info", callback_data: "exam" }],
    [{ text: "🔗 Useful Links", callback_data: "links" }],
    [
      {
        text: "📩 Contact to Owner",
        url: `https://t.me/${SUPPORT_BOT}?start=from_study_hub`
      },
    ],
  ],
};

const BACK_MENU = {
  inline_keyboard: [[{ text: "⬅️ Back to Menu", callback_data: "menu" }]],
};

// ===== TEXTS =====
const WELCOME_TEXT =
  "👋 *Welcome to Study Resource Hub* 📘\n\n" +
  "🎯 A dedicated place for curated academic resources\n" +
  "and useful study material.\n\n" +
  "📚 What you’ll find here:\n" +
  "• Study PDFs & Notes\n" +
  "• Exam-related information\n" +
  "• Useful learning links\n\n" +
  "👇 Please choose a section below to continue.";

const MENU_TEXT =
  "📘 *Main Menu*\n\n👇 Select a section below to access curated study resources.";

const PDF_TEXT =
  "📘 *Study PDFs* 📄\n\n" +
  "📂 High-quality study PDFs will be added here.\n" +
  "⏳ Please check back soon.";

const NOTES_TEXT =
  "📚 *Study Notes* 🖊️\n\n" +
  "📖 Well-organized notes for easy revision\n" +
  "will be available here shortly.";

const EXAM_TEXT =
  "📝 *Exam Information* 📅\n\n" +
  "🔔 Verified exam updates, notices\n" +
  "and important dates will appear here.";

const LINKS_TEXT =
  "🔗 *Useful Learning Links* 🌐\n\n" +
  "⭐ Trusted educational tools and\n" +
  "learning resources will be shared here.";

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;

    // /start
    if (update.message && update.message.text === "/start") {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;

      if (!(await isJoined(userId))) {
        await tg("sendMessage", {
          chat_id: chatId,
          text:
            "🔒 *Access Restricted*\n\n" +
            "To use *Study Resource Hub*,\n" +
            "please join our official channel first.",
          parse_mode: "Markdown",
          reply_markup: JOIN_MENU,
        });
        return res.send("ok");
      }

      await tg("sendMessage", {
        chat_id: chatId,
        text: WELCOME_TEXT,
        parse_mode: "Markdown",
        reply_markup: MAIN_MENU,
      });
      return res.send("ok");
    }

    // Buttons
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const msgId = cq.message.message_id;

      if (cq.data === "check_join") {
        if (!(await isJoined(cq.from.id))) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "❌ Please join the channel first.",
            show_alert: true,
          });
          return res.send("ok");
        }

        await tg("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: MENU_TEXT,
          parse_mode: "Markdown",
          reply_markup: MAIN_MENU,
        });
      }

      if (cq.data === "menu") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: MENU_TEXT,
          parse_mode: "Markdown",
          reply_markup: MAIN_MENU,
        });
      }

      if (cq.data === "pdfs") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: PDF_TEXT,
          parse_mode: "Markdown",
          reply_markup: BACK_MENU,
        });
      }

      if (cq.data === "notes") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: NOTES_TEXT,
          parse_mode: "Markdown",
          reply_markup: BACK_MENU,
        });
      }

      if (cq.data === "exam") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: EXAM_TEXT,
          parse_mode: "Markdown",
          reply_markup: BACK_MENU,
        });
      }

      if (cq.data === "links") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: msgId,
          text: LINKS_TEXT,
          parse_mode: "Markdown",
          reply_markup: BACK_MENU,
        });
      }

      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return res.send("ok");
    }

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Study Resource Hub running on port", PORT);
});
