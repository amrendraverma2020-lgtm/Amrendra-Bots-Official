const { Telegraf } = require("telegraf");
const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in environment");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ===== CONFIG =====
const TEMP_DIR = "./temp";
const MAX_SIZE = 300 * 1024 * 1024; // 300 MB
const RENAME_PREFIX = "@AmrendraBots"; // 🔁 change as you want
// ===================

fs.ensureDirSync(TEMP_DIR);

const activeUsers = new Set();

// ===== START COMMAND =====
bot.start(ctx => {
  ctx.reply(
    "🤖 File Renamer Bot\n\n" +
    "📂 Video ya Document bhejo\n" +
    "♻️ Main rename karke wapas bhej dunga\n\n" +
    "⚠️ Max file size: 300MB"
  );
});

// ===== FILE HANDLER =====
bot.on(["document", "video"], async ctx => {
  const userId = ctx.from.id;

  if (activeUsers.has(userId)) {
    return ctx.reply("⏳ Pehle wali file process ho rahi hai, wait karo");
  }

  const file = ctx.message.document || ctx.message.video;

  if (file.file_size > MAX_SIZE) {
    return ctx.reply("❌ File too large (Max 300MB allowed)");
  }

  activeUsers.add(userId);

  let tempPath = "";

  try {
    await ctx.reply("📥 File mil gayi, processing...");

    // ===== FILE INFO =====
    const originalName =
      file.file_name ||
      `video_${Date.now()}.mp4`;

    const safeName = originalName.replace(/[^\w.\-]/g, "_");
    const newFileName = `${RENAME_PREFIX}_${safeName}`;

    tempPath = path.join(TEMP_DIR, newFileName);

    // ===== DOWNLOAD FILE =====
    const fileLink = await ctx.telegram.getFileLink(file.file_id);

    const response = await fetch(fileLink.href);
    const buffer = await response.arrayBuffer();

    await fs.writeFile(tempPath, Buffer.from(buffer));

    // ===== UPLOAD BACK =====
    await ctx.reply("📤 Uploading renamed file...");

    if (ctx.message.video) {
      await ctx.replyWithVideo(
        { source: tempPath },
        { caption: `✅ Renamed\n${newFileName}` }
      );
    } else {
      await ctx.replyWithDocument(
        { source: tempPath },
        { caption: `✅ Renamed\n${newFileName}` }
      );
    }

  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Error aaya, baad me try karo");
  } finally {
    // ===== CLEANUP =====
    if (tempPath && fs.existsSync(tempPath)) {
      await fs.remove(tempPath);
    }
    activeUsers.delete(userId);
  }
});

// ===== BOT START =====
bot.launch();
console.log("✅ Bot started successfully");

// ===== SAFE SHUTDOWN =====
process.on("SIGINT", () => bot.stop("SIGINT"));
process.on("SIGTERM", () => bot.stop("SIGTERM"));
