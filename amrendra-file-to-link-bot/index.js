const express = require("express");

const app = express();
app.use(express.json());

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000;

// ===== TELEGRAM API =====
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ===== HELPER: SEND MESSAGE =====
async function sendMessage(chatId, text, markdown = false) {
  const body = {
    chat_id: chatId,
    text: text,
  };
  if (markdown) body.parse_mode = "Markdown";

  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ===== HELPER: GET FILE PATH =====
async function getTelegramFile(fileId) {
  const res = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
  const data = await res.json();
  return data.result.file_path;
}

// ===== HELPER: DOWNLOAD FILE =====
async function downloadTelegramFile(filePath) {
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  return await fetch(url);
}

// ===== HELPER: UPLOAD TO GOFILE =====
async function uploadToGoFile(stream, filename) {
  // 1. Get best server
  const serverRes = await fetch("https://api.gofile.io/getServer");
  const serverData = await serverRes.json();
  const server = serverData.data.server;

  // 2. Upload file
  const form = new FormData();
  form.append("file", stream, filename);

  const uploadRes = await fetch(`https://${server}.gofile.io/uploadFile`, {
    method: "POST",
    body: form,
  });

  const text = await uploadRes.text();
  if (!text.startsWith("{")) throw new Error("GoFile upload failed");

  const json = JSON.parse(text);
  return json.data.downloadPage;
}

// ===== HEALTH CHECK =====
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
      await sendMessage(
        chatId,
        "👋 *Welcome to Amrendra File To Link Bot*\n\n" +
          "📦 Send me any file.\n" +
          "⚡ Small files → Fast browser link\n" +
          "🛡 Large files → Smart Telegram mode",
        true
      );
      return res.send("ok");
    }

    // ===== FILE DETECTION =====
    const file =
      msg.document || msg.video || msg.audio;

    if (!file) return res.send("ok");

    const fileSizeMB = file.file_size / (1024 * 1024);

    await sendMessage(
      chatId,
      `📦 File detected\nSize: ${fileSizeMB.toFixed(1)} MB`
    );

    // ===== SMART MODE (>= 300 MB) =====
    if (fileSizeMB >= 300) {
      await sendMessage(
        chatId,
        "🤖 *Smart Download Mode Activated*\n\n" +
          "To ensure maximum download stability and accuracy, this file is optimized for direct Telegram download.\n\n" +
          "💡 Tip: Fast browser downloads are available for smaller files to provide better speed.",
        true
      );
      return res.send("ok");
    }

    // ===== FAST MODE =====
    await sendMessage(
      chatId,
      "⚡ *Fast Mode Activated*\n\n⏳ Uploading your file to generate a fast download link.\nPlease wait…",
      true
    );

    // 1. Get file path
    const filePath = await getTelegramFile(file.file_id);

    // 2. Download from Telegram
    const tgFile = await downloadTelegramFile(filePath);

    // 3. Upload to GoFile
    const link = await uploadToGoFile(
      tgFile.body,
      file.file_name || "file"
    );

    // 4. Send link
    await sendMessage(
      chatId,
      `✅ *Upload Complete!*\n\n🔗 Download Link:\n${link}\n\n🚀 Enjoy fast browser download.`,
      true
    );

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
