const express = require("express");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

// ==================
// Dummy HTTP Server
// ==================
const app = express();

app.get("/", (req, res) => {
  res.send("Amrendra File Bot is running ✅");
});

app.listen(PORT, () => {
  console.log(`🌐 Dummy server running on port ${PORT}`);
});

// ==================
// Telegram Bot
// ==================
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(
    "👋 *Welcome to Amrendra File Bot*\n\n" +
    "📦 Send me a video or document.\n" +
    "⚡ Free long polling mode active.\n\n" +
    "More features coming soon 🚀",
    { parse_mode: "Markdown" }
  );
});

bot.on(["video", "document"], async (ctx) => {
  try {
    const file =
      ctx.message.video || ctx.message.document;

    const sizeMB = (file.file_size / (1024 * 1024)).toFixed(1);

    await ctx.reply(
      `📦 File received (${sizeMB} MB)\n⏳ Processing...`
    );

    // Test response only (no download yet)
    await ctx.reply(
      "✅ File detected successfully.\n\n" +
      "🛠 Processing logic will be added next."
    );
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error while processing file.");
  }
});

// ==================
// Start Long Polling
// ==================
bot.launch().then(() => {
  console.log("🤖 Bot started (Long Polling)");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
