const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing in environment variables");
}

const bot = new Telegraf(BOT_TOKEN);

// Step memory (simple, safe)
const userState = {};

// START
bot.start((ctx) => {
  ctx.reply(
    "👋 *Welcome to Amrendra File Renamer Bot*\n\n" +
    "📦 Send me any *video or document*\n" +
    "✏️ I will ask for the new filename\n" +
    "🚀 File will be renamed without re-uploading\n\n" +
    "_Fast • Safe • No size limit_",
    { parse_mode: "Markdown" }
  );
});

// RECEIVE FILE
bot.on(["video", "document"], async (ctx) => {
  const msg = ctx.message;
  const fileMessageId = msg.message_id;

  userState[ctx.from.id] = {
    chatId: ctx.chat.id,
    messageId: fileMessageId,
    fileType: msg.video ? "video" : "document"
  };

  await ctx.reply(
    "✏️ *Enter new filename*\n\n" +
    "Example:\n`My_Renamed_File.mp4`",
    { parse_mode: "Markdown" }
  );
});

// RECEIVE NEW NAME
bot.on("text", async (ctx) => {
  const state = userState[ctx.from.id];
  if (!state) return;

  let newName = ctx.message.text.trim();

  // sanitize filename
  newName = newName.replace(/[\\/:*?"<>|]/g, "_");

  try {
    await ctx.telegram.copyMessage(
      state.chatId,
      state.chatId,
      state.messageId,
      {
        caption: `📦 Renamed by @AmrendraBots`,
        ...(state.fileType === "document"
          ? { document: { file_name: newName } }
          : {})
      }
    );

    await ctx.reply("✅ *File renamed successfully!*", {
      parse_mode: "Markdown"
    });
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Rename failed. Try again.");
  }

  delete userState[ctx.from.id];
});

// LONG POLLING (NO WEBHOOK, NO PORT ISSUE)
bot.launch();

console.log("✅ File Renamer Bot is running");

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
