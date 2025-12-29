const express = require("express");
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

const PORT = process.env.PORT || 10000;

const TEMP_DIR = path.join(__dirname, "temp");
const THUMB_DIR = path.join(__dirname, "thumbnails");

fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(THUMB_DIR);

// =======================
// EXPRESS (FOR RENDER)
// =======================
app.get("/", (req, res) => {
  res.send("Amrendra File Renamer Bot is running ✅");
});

app.listen(PORT, () => {
  console.log("HTTP server running on port", PORT);
});

// =======================
// BOT COMMANDS
// =======================
bot.start(ctx => {
  ctx.reply(
    "👋 *Welcome to Amrendra File Renamer Bot*\n\n" +
    "📤 Send any video or document\n" +
    "🖼 Send a photo to set thumbnail\n" +
    "✏️ File will be renamed & re-uploaded\n\n" +
    "⚡ Max size ~300MB",
    { parse_mode: "Markdown" }
  );
});

// =======================
// SAVE THUMBNAIL
// =======================
bot.on("photo", async ctx => {
  const userId = ctx.from.id;
  const photo = ctx.message.photo.pop();

  const fileLink = await ctx.telegram.getFileLink(photo.file_id);
  const thumbPath = path.join(THUMB_DIR, `${userId}.jpg`);

  const response = await axios.get(fileLink.href, { responseType: "stream" });
  const writer = fs.createWriteStream(thumbPath);

  response.data.pipe(writer);

  writer.on("finish", () => {
    ctx.reply("✅ Thumbnail saved successfully");
  });
});

// =======================
// FILE HANDLER
// =======================
bot.on(["video", "document"], async ctx => {
  const msg = ctx.message;
  const file = msg.video || msg.document;
  const userId = ctx.from.id;

  const fileSizeMB = (file.file_size / (1024 * 1024)).toFixed(1);
  if (file.file_size > 300 * 1024 * 1024) {
    return ctx.reply("❌ File too large. Max 300MB allowed.");
  }

  await ctx.reply(`📦 File received (${fileSizeMB} MB)\n⏳ Processing...`);

  const fileLink = await ctx.telegram.getFileLink(file.file_id);
  const ext = path.extname(file.file_name || ".bin");

  const cleanName =
    "AmrendraBots_" +
    Date.now() +
    ext;

  const tempFilePath = path.join(TEMP_DIR, cleanName);

  // Download file
  const response = await axios.get(fileLink.href, { responseType: "stream" });
  const writer = fs.createWriteStream(tempFilePath);
  response.data.pipe(writer);

  writer.on("finish", async () => {
    const thumbPath = path.join(THUMB_DIR, `${userId}.jpg`);

    const sendOptions = {};
    if (fs.existsSync(thumbPath)) {
      sendOptions.thumb = { source: thumbPath };
    }

    await ctx.reply("📤 Uploading renamed file...");

    await ctx.replyWithDocument(
      { source: tempFilePath, filename: cleanName },
      sendOptions
    );

    fs.removeSync(tempFilePath);
  });
});

// =======================
// START BOT
// =======================
bot.launch().then(() => {
  console.log("Bot started successfully");
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
