const express = require("express");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// ================= UTILS =================
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ================= HEALTH =================
app.get("/", (_, res) => {
  res.send("Amrendra File To Link Bot running");
});

// ================= WEBHOOK =================
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.send("ok");

    const chatId = msg.chat.id;

    // ===== FILE DETECTION =====
    const file =
      msg.document ||
      msg.video ||
      msg.audio;

    if (!file) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "📎 Please send a file to generate a download link.",
      });
      return res.send("ok");
    }

    const sizeMB = (file.file_size / 1024 / 1024).toFixed(1);

    // ===== SMART MODE =====
    if (file.file_size >= 300 * 1024 * 1024) {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "🤖 Smart Download Mode Activated\n\n" +
          "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
          "💡 Tip: Fast browser downloads are available for smaller files to provide better speed.",
      });
      return res.send("ok");
    }

    // ===== FAST MODE =====
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "⚡ Fast Mode\n\n" +
        `📦 File Size: ${sizeMB} MB\n\n` +
        "⏳ Uploading file… Please wait",
    });

    // ===== GET FILE PATH =====
    const fileInfo = await tg("getFile", { file_id: file.file_id });
    if (!fileInfo.ok || !fileInfo.result.file_path) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Failed to read file from Telegram.",
      });
      return res.send("ok");
    }

    const tgFileUrl =
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;

    // ===== GET GOFILE SERVER =====
    const serverRes = await fetch("https://api.gofile.io/getServer");
    const serverData = await serverRes.json();
    const server = serverData.data.server;

    // ===== DOWNLOAD & UPLOAD =====
    const tgStream = await fetch(tgFileUrl);
    const form = new FormData();
    form.append("file", tgStream.body, file.file_name || "file");

    const uploadRes = await fetch(
      `https://${server}.gofile.io/uploadFile`,
      { method: "POST", body: form }
    );

    const uploadData = await uploadRes.json();

    if (!uploadData.data || !uploadData.data.downloadPage) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Upload failed. Please try again later.",
      });
      return res.send("ok");
    }

    // ===== SEND LINK =====
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "✅ *Download Ready*\n\n" +
        `🔗 ${uploadData.data.downloadPage}`,
      parse_mode: "Markdown",
    });

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("Amrendra File To Link Bot running on port", PORT);
});
