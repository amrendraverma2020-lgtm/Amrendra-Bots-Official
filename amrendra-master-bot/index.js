const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// ===================== ENV =====================
const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const PORT = process.env.PORT || 10000;

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "20", 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "3000", 10);

// 21 bot tokens (empty ignored)
const BOT_TOKENS = Array.from({ length: 21 }, (_, i) =>
  process.env[`BOT_${i + 1}_TOKEN`]
).filter(Boolean);

if (!MASTER_TOKEN || !OWNER_ID) {
  throw new Error("Missing MASTER_BOT_TOKEN or OWNER_ID");
}

// ===================== HELPERS =====================
async function tg(method, body, token = MASTER_TOKEN) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===================== STATE =====================
let pending = {
  text: null,
  selectedBots: new Set(),
};

// ===================== SECURITY =====================
function ownerOnly(update) {
  const uid =
    update?.message?.from?.id ||
    update?.callback_query?.from?.id;
  return String(uid) === OWNER_ID;
}

// ===================== UI =====================
function botButtons() {
  const rows = [];

  for (let i = 0; i < 21; i++) {
    if (!process.env[`BOT_${i + 1}_TOKEN`]) continue;
    const checked = pending.selectedBots.has(i + 1) ? "✅" : "☑️";
    rows.push([
      {
        text: `${checked} BOT ${i + 1}`,
        callback_data: `toggle:${i + 1}`,
      },
    ]);
  }

  rows.push([
    { text: "✔️ Select All", callback_data: "select_all" },
  ]);

  rows.push([
    { text: "🚀 Send Message", callback_data: "confirm" },
    { text: "❌ Cancel", callback_data: "cancel" },
  ]);

  return { inline_keyboard: rows };
}

// ===================== SEND REAL MESSAGES =====================
async function sendViaBots(messageText) {
  let total = 0;

  for (const token of BOT_TOKENS) {
    // ⚠️ IMPORTANT:
    // Yahan har bot apne USERS pe bhejega.
    // Abhi demo ke liye OWNER_ID use ho raha hai.
    const targets = [OWNER_ID];

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((uid) =>
          tg("sendMessage", { chat_id: uid, text: messageText }, token)
            .catch(() => null)
        )
      );
      total += batch.length;
      await sleep(BATCH_DELAY_MS);
    }
  }

  return total;
}

// ===================== ROUTES =====================
app.get("/", (_, res) => {
  res.send("Amrendra Master Bot running");
});

app.post("/", async (req, res) => {
  try {
    const u = req.body;

    if (!ownerOnly(u)) return res.send("ok");

    // ===== TEXT MESSAGE =====
    if (u.message?.text) {
      pending.text = u.message.text;
      pending.selectedBots.clear();

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text:
          "👋 Welcome, Amrendra\n\n" +
          "This is your private control desk.\n" +
          "Select which bots should receive your message.",
        reply_markup: botButtons(),
      });
      return res.send("ok");
    }

    // ===== BUTTON HANDLING =====
    if (u.callback_query) {
      const d = u.callback_query.data;

      if (d.startsWith("toggle:")) {
        const n = parseInt(d.split(":")[1], 10);
        pending.selectedBots.has(n)
          ? pending.selectedBots.delete(n)
          : pending.selectedBots.add(n);
      } 
      else if (d === "select_all") {
        pending.selectedBots.clear();
        for (let i = 1; i <= 21; i++) {
          if (process.env[`BOT_${i}_TOKEN`]) pending.selectedBots.add(i);
        }
      } 
      else if (d === "confirm") {
        await sendViaBots(pending.text);

        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "✅ Message sent successfully.",
        });

        pending = { text: null, selectedBots: new Set() };
      } 
      else if (d === "cancel") {
        pending = { text: null, selectedBots: new Set() };
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "❌ Cancelled.",
        });
      }

      await tg("answerCallbackQuery", {
        callback_query_id: u.callback_query.id,
      });

      if (pending.text) {
        await tg("editMessageReplyMarkup", {
          chat_id: OWNER_ID,
          message_id: u.callback_query.message.message_id,
          reply_markup: botButtons(),
        });
      }

      return res.send("ok");
    }

    return res.send("ok");
  } catch (e) {
    console.error(e);
    return res.send("ok");
  }
});

// ===================== START =====================
app.listen(PORT, () => {
  console.log("Amrendra Master Bot running on port", PORT);
});
