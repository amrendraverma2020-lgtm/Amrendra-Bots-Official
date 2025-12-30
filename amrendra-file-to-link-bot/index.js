const express = require("express");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const HF_TOKEN = process.env.HF_TOKEN;
const PORT = process.env.PORT || 10000;

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("HuggingFace AI Bot is running");
});

// ===== HUGGING FACE QUERY =====
async function queryHuggingFace(text) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/google/flan-t5-small",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: text,
      }),
    }
  );

  const data = await response.json();

  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text;
  }

  return "🤖 Sorry, I couldn't generate a reply right now.";
}

// ===== SEND MESSAGE =====
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

// ===== TELEGRAM WEBHOOK =====
app.post("/", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.send("ok");

    const userText = msg.text;
    const reply = await queryHuggingFace(userText);

    await sendMessage(msg.chat.id, reply);
    res.send("ok");
  } catch (err) {
    console.error("ERROR:", err);
    res.send("ok");
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
