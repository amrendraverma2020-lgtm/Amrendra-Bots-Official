// ===============================
// Amrendra File Bot – STABLE BASE
// ===============================

// ---- Dummy HTTP Server (RENDER REQUIREMENT) ----
const express = require("express");
const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Amrendra File Bot is running");
});

app.listen(PORT, () => {
  console.log("HTTP server running on port", PORT);
});

// ---- Telegram Bot (Telegraf) ----
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in environment variables");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---- START COMMAND ----
bot.start((ctx) => {
  ctx.reply(
    "🤖 *Amrendra File Bot*\n\n" +
      "📦 Send me a file (video / document)\n" +
      "🛠 Processing logic will be added next.\n\n" +
      "✅ Bot is running stable.",
    { parse_mode: "Markdown" }
  );
});

// ---- FILE HANDLER (SAFE, NO DOWNLOAD) ----
bot.on(["video", "document", "audio"], async (ctx) => {
  try {
    const msg = ctx.message;
    let fileSize = 0;

    if (msg.video) fileSize = msg.video.file_size;
    else if (msg.document) fileSize = msg.document.file_size;
    else if (msg.audio) fileSize = msg.audio.file_size;

    const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);

    await ctx.reply(
      `📦 *File received successfully*\n\n` +
        `📊 Size: *${sizeMB} MB*\n\n` +
        `🛠 Processing logic will be added next.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("File handler error:", err);
    ctx.reply("⚠️ Something went wrong. Please try again.");
  }
});

// ---- LAUNCH BOT (LONG POLLING SAFE) ----
bot.launch({
  dropPendingUpdates: true,
});

console.log("✅ File Bot is running");

// ---- GRACEFUL SHUTDOWN ----
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
