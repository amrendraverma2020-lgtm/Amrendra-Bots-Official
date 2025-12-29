const express = require("express");
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// ===== DUMMY HTTP SERVER (RENDER REQUIRED) =====
app.get("/", (req, res) => {
  res.send("Amrendra File Renamer Bot is running ✅");
});

app.listen(PORT, () => {
  console.log("🌐 Web server running on port", PORT);
});

// ===== TEMP STORAGE =====
const TEMP_DIR = path.join(__dirname, "temp");
fs.ensureDirSync(TEMP_DIR);

// ===== USER STATE (IN-MEMORY) =====
const userState = new Map();

// ===== START =====
bot.start((ctx) => {
  ctx.reply(
    "👋 *Welcome to Amrendra File Renamer Bot*\n\n" +
    "📦 Send a video or document\n" +
    "✏️ Then choose a new file name\n\n" +
    "⚠️ Max recommended size: 200–300 MB",
    { parse_mode: "Markdown" }
  );
});

// ===== FILE RECEIVE =====
bot.on(["video", "document"], async (ctx) => {
  const file =
    ctx.message.video || ctx.message.document;

  const fileSizeMB = (file.file_size / (1024 * 1024)).toFixed(1);

  if (file.file_size > 300 * 1024 * 1024) {
    return ctx.reply("❌ File too large. Max 300 MB allowed.");
  }

  userState.set(ctx.from.id, {
    file_id: file.file_id,
    original_name: file.file_name || "file",
    mime_type: file.mime_type,
  });

  ctx.reply(
    `📦 *File received* (${fileSizeMB} MB)\n\n` +
    "✏️ Please send the *new file name*\n" +
    "_(extension likhne ki zarurat nahi)_",
    { parse_mode: "Markdown" }
  );
});

// ===== FILENAME INPUT =====
bot.on("text", async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (!state) return;

  let newName = ctx.message.text
    .replace(/[<>:"/\\|?*]+/g, "")
    .trim();

  if (!newName) {
    return ctx.reply("⚠️ Invalid name. Please send a valid text name.");
  }

  const fileLink = await ctx.telegram.getFileLink(state.file_id);
  const ext = path.extname(state.original_name) || "";

  const finalName = `${newName}${ext}`;
  const tempPath = path.join(TEMP_DIR, finalName);

  ctx.reply("⏳ Processing your file…");

  try {
    // Download
    const response = await axios({
      url: fileLink.href,
      method: "GET",
      responseType: "stream",
    });

    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(tempPath);
      response.data.pipe(stream);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    // Upload back
    await ctx.replyWithDocument(
      { source: tempPath, filename: finalName },
      { caption: "✅ Renamed successfully" }
    );

  } catch (err) {
    console.error(err);
    ctx.reply("❌ Failed to process file.");
  } finally {
    fs.remove(tempPath);
    userState.delete(ctx.from.id);
  }
});

// ===== START BOT =====
bot.launch();
console.log("🤖 Bot started successfully");
