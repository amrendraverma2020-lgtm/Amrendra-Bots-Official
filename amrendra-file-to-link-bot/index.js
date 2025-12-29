import express from "express";

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// ===== HELPERS =====
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("Amrendra File To Link Bot is running");
});

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.send("ok");

    const chatId = msg.chat.id;

    // ===== /start =====
    if (msg.text === "/start") {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "👋 *Welcome to Amrendra File To Link Bot*\n\n" +
          "📤 Send any file, video or audio.\n" +
          "🤖 Bot will automatically choose the best download method.",
        parse_mode: "Markdown",
      });
      return res.send("ok");
    }

    // ===== FILE DETECTION =====
    const file =
      msg.document || msg.video || msg.audio || null;

    if (!file) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Please send a file, video or audio.",
      });
      return res.send("ok");
    }

    const fileSize = file.file_size || 0;
    const sizeMB = formatMB(fileSize);

    // ===== LARGE FILE MODE =====
    if (fileSize >= 300 * 1024 * 1024) {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "📦 *File detected*\n" +
          `Size: ${sizeMB} MB\n\n` +
          "🤖 *Smart Download Mode Activated*\n\n" +
          "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
          "💡 Tip: Fast browser downloads are available for smaller files to provide better speed.",
        parse_mode: "Markdown",
      });
      return res.send("ok");
    }

    // ===== SMALL FILE → GOFILE =====
    await tg("sendMessage", {
      chat_id: chatId,
      text: "⏳ Uploading file… Please wait",
    });

    // 1️⃣ Get Telegram file path
    const fileInfo = await tg("getFile", { file_id: file.file_id });

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Failed to fetch file from Telegram. Please try again.",
      });
      return res.send("ok");
    }

    const tgFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;

    // 2️⃣ Get GoFile server
    const serverRes = await fetch("https://api.gofile.io/servers");
    const serverText = await serverRes.text();

    let serverData;
    try {
      serverData = JSON.parse(serverText);
    } catch {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Upload service unavailable. Try again later.",
      });
      return res.send("ok");
    }

    if (serverData.status !== "ok") {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Upload service error. Try again later.",
      });
      return res.send("ok");
    }

    const uploadServer = serverData.data.servers[0].name;

    // 3️⃣ Upload to GoFile
    const uploadRes = await fetch(`https://${uploadServer}.gofile.io/uploadFile`, {
      method: "POST",
      body: (() => {
        const fd = new FormData();
        fd.append("file", tgFileUrl);
        return fd;
      })(),
    });

    const uploadText = await uploadRes.text();
    let uploadData;

    try {
      uploadData = JSON.parse(uploadText);
    } catch {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Upload failed. Please try again later.",
      });
      return res.send("ok");
    }

    if (uploadData.status !== "ok") {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Upload failed. Please try again later.",
      });
      return res.send("ok");
    }

    // 4️⃣ Send link
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "⚡ *Fast Mode*\n\n" +
        `📦 Size: ${sizeMB} MB\n\n` +
        "🔗 *Download Link:*\n" +
        uploadData.data.downloadPage,
      parse_mode: "Markdown",
    });

    return res.send("ok");
  } catch (err) {
    console.error(err);
    return res.send("ok");
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log("Amrendra File To Link Bot running on port", PORT);
});
