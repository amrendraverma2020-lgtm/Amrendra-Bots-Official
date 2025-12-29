const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPPORT_BOT = process.env.SUPPORT_BOT || "@amrendra_support_bot";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing in environment variables");
}

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Study Resource Hub bot is running");
});

// ===== SEND MESSAGE =====
async function sendMessage(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// ===== KEYBOARDS =====
const MAIN_MENU = {
  inline_keyboard: [
    [{ text: "📘 PDFs", callback_data: "pdfs" }],
    [{ text: "📚 Notes", callback_data: "notes" }],
    [{ text: "📝 Exam Info", callback_data: "exam" }],
    [{ text: "🔗 Useful Links", callback_data: "links" }],
    [{ text: "🛠 Support", url: `https://t.me/${SUPPORT_BOT.replace("@","")}` }]
  ]
};

const BACK_MENU = {
  inline_keyboard: [
    [{ text: "⬅️ Back to Menu", callback_data: "menu" }]
  ]
};

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const update = req.body;

    // Messages
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;

      if (msg.text === "/start") {
        await sendMessage(
          chatId,
          "👋 *Welcome to Study Resource Hub* 📘\n\n" +
          "Here you’ll find well-organized study resources.\n\n" +
          "📚 Available:\n" +
          "• PDFs & Notes\n" +
          "• Exam information\n" +
          "• Useful learning links\n\n" +
          "👉 Choose an option below.",
          MAIN_MENU
        );
      }
      return res.send("ok");
    }

    // Callback queries (buttons)
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const data = cq.data;

      if (data === "menu") {
        await sendMessage(chatId, "📘 *Main Menu*", MAIN_MENU);
      }

      if (data === "pdfs") {
        await sendMessage(
          chatId,
          "📘 *PDFs Section*\n\n" +
          "Study PDFs will be added here.\n" +
          "Please check back soon.",
          BACK_MENU
        );
      }

      if (data === "notes") {
        await sendMessage(
          chatId,
          "📚 *Notes Section*\n\n" +
          "Class-wise and topic-wise notes will be available here.",
          BACK_MENU
        );
      }

      if (data === "exam") {
        await sendMessage(
          chatId,
          "📝 *Exam Information*\n\n" +
          "Latest exam updates, dates and notices will appear here.",
          BACK_MENU
        );
      }

      if (data === "links") {
        await sendMessage(
          chatId,
          "🔗 *Useful Links*\n\n" +
          "Helpful learning links and tools will be shared here.",
          BACK_MENU
        );
      }

      // answer callback
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cq.id })
      });

      return res.send("ok");
    }

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

// ===== START =====
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log("Study Resource Hub running on port", PORT);
});
