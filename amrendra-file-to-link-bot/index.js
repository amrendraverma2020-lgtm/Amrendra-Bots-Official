const express = require("express");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;   // Telegram Bot Token
const HF_TOKEN = process.env.HF_TOKEN;     // HuggingFace Token
const PORT = process.env.PORT || 10000;

// ===== HEALTH CHECK (RENDER KE LIYE ZAROORI) =====
app.get("/", (req, res) => {
  res.send("✅ Amrendra AI Bot is running");
});

// ===== TELEGRAM MESSAGE SEND =====
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// ===== HUGGING FACE AI CALL =====
async function askAI(prompt) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/google/flan-t5-small",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
      }),
    }
  );

  const data = await response.json();

  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text;
  }

  return "❌ AI reply generate nahi ho paayi. Thodi der baad try karo.";
}

// ===== TELEGRAM WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) {
      return res.send("ok");
    }

    const chatId = message.chat.id;
    const userText = message.text;

    const aiReply = await askAI(userText);
    await sendMessage(chatId, aiReply);

    res.send("ok");
  } catch (err) {
    console.error("Error:", err);
    res.send("ok");
  }
});

// ===== SERVER START =====
app.listen(PORT, () => {
  console.log("🚀 Amrendra AI Bot running on port", PORT);
});
