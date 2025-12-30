const express = require("express");

const app = express();
app.use(express.json());

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;     // Telegram Bot Token
const HF_TOKEN = process.env.HF_TOKEN;       // HuggingFace Token
const PORT = process.env.PORT || 10000;

// ===== HEALTH CHECK (RENDER REQUIREMENT) =====
app.get("/", (req, res) => {
  res.send("Amrendra AI Bot is running");
});

// ===== SEND MESSAGE TO TELEGRAM =====
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// ===== ASK AI (HUGGING FACE) =====
async function askAI(prompt) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/google/flan-t5-small",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: prompt }),
    }
  );

  const data = await response.json();

  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text;
  }

  return "Sorry, I couldn't generate a reply right now.";
}

// ===== TELEGRAM WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.send("ok");

    const userText = msg.text;
    const chatId = msg.chat.id;

    const aiReply = await askAI(userText);
    await sendMessage(chatId, aiReply);

    res.send("ok");
  } catch (err) {
    console.error(err);
    res.send("ok");
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("✅ Amrendra AI Bot running on port", PORT);
});
