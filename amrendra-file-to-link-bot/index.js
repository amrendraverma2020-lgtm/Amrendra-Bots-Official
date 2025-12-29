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
const TEMP_DIR = "./temp";
fs.ensureDirSync(TEMP_DIR);

// /start
bot.start((ctx) => {
  ctx.reply(
    "👋 Welcome to Amrendra File Renamer Bot\n\n" +
    "📤 Send any video or document\n" +
    "✏️ Bot will rename & send back\n\n" +
    "⚡ Fast • Free • Safe"
  );
});

// Handle files
bot.on(["video", "document"], async (ctx) => {
  try {
    const file = ctx.message.video || ctx.message.document;
    const sizeMB = file.file_size / (1024 * 1024);

    if (sizeMB > 300) {
      return ctx.reply("❌ File too large (max 300MB allowed)");
    }

    await ctx.reply("⏳ Processing your file…");

    const fileLink = await ctx.telegram.getFileLink(file.file_id);
    const ext = path.extname(file.file_name || ".mp4");
    const newName = `@AmrendraBots_${Date.now()}${ext}`;
    const tempPath = path.join(TEMP_DIR, newName);

    const response = await axios.get(fileLink.href, {
      responseType: "stream",
    });

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    await new Promise((res, rej) => {
      writer.on("finish", res);
      writer.on("error", rej);
    });

    await ctx.replyWithDocument({ source: tempPath });

    fs.unlinkSync(tempPath);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error while processing file");
  }
});

bot.launch();
console.log("✅ File Renamer Bot Started");
