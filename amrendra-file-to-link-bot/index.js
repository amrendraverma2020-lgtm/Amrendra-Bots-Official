const express = require("express");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// ===== SEND MESSAGE =====
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}

// ===== GET FILE URL FROM TELEGRAM =====
async function getTelegramFile(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
}

// ===== GOFILE UPLOAD =====
async function uploadToGoFile(fileUrl) {
  const serverRes = await fetch("https://api.gofile.io/getServer");
  const server = (await serverRes.json()).data.server;

  const uploadRes = await fetch(`https://${server}.gofile.io/uploadFile`, {
    method: "POST",
    body: new URLSearchParams({ file: fileUrl }),
  });

  const result = await uploadRes.json();
  return result.data.downloadPage;
}

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.send("ok");

    const chatId = msg.chat.id;

    // /start
    if (msg.text === "/start") {
      await sendMessage(
        chatId,
        "📂 *Amrendra File To Link Bot*\n\n" +
          "Forward any file here.\n" +
          "• ≤ 300 MB → Fast browser link\n" +
          "• > 300 MB → Telegram optimized\n\n" +
          "No login • No card • No extra data"
      );
      return res.send("ok");
    }

    const file =
      msg.document || msg.video || msg.audio || msg.voice || null;

    if (!file) {
      await sendMessage(chatId, "❌ Please send a valid file.");
      return res.send("ok");
    }

    const sizeMB = file.file_size / (1024 * 1024);

    // ===== LARGE FILE =====
    if (sizeMB > 300) {
      await sendMessage(
        chatId,
        "🤖 Smart Download Mode Activated\n\n" +
          "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
          "💡 Tip: Fast browser downloads are available for smaller files to provide better speed."
      );
      return res.send("ok");
    }

    // ===== SMALL FILE → LINK =====
    await sendMessage(chatId, "⏳ Uploading file… Please wait");

    const tgFileUrl = await getTelegramFile(file.file_id);
    const link = await uploadToGoFile(tgFileUrl);

    await sendMessage(
      chatId,
      "✅ *Download Ready*\n\n" +
        `🔗 ${link}\n\n` +
        "⚡ Fast browser download enabled"
    );

    res.send("ok");
  } catch (e) {
    console.error(e);
    res.send("ok");
  }
});

// ===== START =====
app.listen(PORT, () =>
  console.log("Amrendra File To Link Bot running")
);
