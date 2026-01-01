const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/* ================= ENV ================= */

const MASTER_TOKEN = process.env.MASTER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID);
const PORT = process.env.PORT || 10000;

const BOT_TOKENS = (process.env.BOT_TOKENS || "")
  .split(",")
  .map(p => {
    const [name, ...rest] = p.split(":");
    return { name: name.trim(), token: rest.join(":").trim() };
  });

/* ================= DB ================= */

const DB_FILE = path.join(__dirname, "../central-db/users.json");

let DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
DB.users = DB.users || {};
DB.stats = DB.stats || { broadcasts: 0 };

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

/* ================= TG ================= */

async function tg(method, body, token = MASTER_TOKEN) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

/* ================= STATE ================= */

let pendingText = null;
let selectedBots = new Set();
let lastReport = null;

/* ================= UI ================= */

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "📊 Live System Status", callback_data: "status" }]
    ]
  };
}

function botKeyboard() {
  const rows = BOT_TOKENS.map((b, i) => [{
    text: `${selectedBots.has(i) ? "✅" : "☑️"} ${b.name} Bot`,
    callback_data: `toggle:${i}`
  }]);

  rows.push([{ text: "✅ Select All Bots", callback_data: "select_all" }]);
  rows.push([{ text: "🚀 Send Broadcast", callback_data: "send" }]);
  rows.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

  return { inline_keyboard: rows };
}

/* ================= LOGIC ================= */

function usersForBot(name) {
  return Object.values(DB.users).filter(u =>
    u.verified &&
    !u.blocked &&
    (u.warnings || 0) < 3 &&
    u.bots?.includes(name)
  );
}

/* ================= WEBHOOK ================= */

app.post("/", async (req, res) => {
  res.send("ok");
  const u = req.body;

  const from =
    u?.message?.from?.id ||
    u?.callback_query?.from?.id;

  if (String(from) !== OWNER_ID) return;

  if (u.callback_query) {
    await tg("answerCallbackQuery", {
      callback_query_id: u.callback_query.id
    });
  }

  /* /start */
  if (u.message?.text === "/start") {
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "Markdown",
      text:
        "👋 *AMRENDRA MASTER CONTROL*\n\n" +
        "Send the message you want to broadcast.",
      reply_markup: mainMenu()
    });
    return;
  }

  /* new message */
  if (u.message?.text && !u.message.text.startsWith("/")) {
    pendingText = u.message.text;
    selectedBots.clear();

    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "Markdown",
      text:
        "📨 *BROADCAST MESSAGE PREVIEW*\n\n" +
        pendingText +
        "\n\nSelect target bots:",
      reply_markup: botKeyboard()
    });
    return;
  }

  /* callbacks */
  if (u.callback_query) {
    const a = u.callback_query.data;

    if (a === "status") {
      const users = Object.values(DB.users);
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "📊 *LIVE SYSTEM STATUS*\n\n" +
          `👥 Total Users: ${users.length}\n` +
          `✅ Verified: ${users.filter(x=>x.verified).length}\n` +
          `🤖 Bots: ${BOT_TOKENS.length}`
      });
      return;
    }

    if (a === "select_all") {
      selectedBots = new Set(BOT_TOKENS.map((_, i) => i));
    }

    if (a.startsWith("toggle:")) {
      const i = Number(a.split(":")[1]);
      selectedBots.has(i) ? selectedBots.delete(i) : selectedBots.add(i);
    }

    await tg("editMessageReplyMarkup", {
      chat_id: OWNER_ID,
      message_id: u.callback_query.message.message_id,
      reply_markup: botKeyboard()
    });

    if (a === "send") {
      if (!selectedBots.size) {
        await tg("sendMessage", {
          chat_id: OWNER_ID,
          text: "⚠️ Select at least one bot."
        });
        return;
      }

      const report = {};
      let total = 0;

      for (const i of selectedBots) {
        const bot = BOT_TOKENS[i];
        const users = usersForBot(bot.name);
        report[bot.name] = users.length;
        total += users.length;

        for (const u of users) {
          await tg("sendMessage", {
            chat_id: u.id,
            text: pendingText
          }, bot.token);
        }
      }

      DB.stats.broadcasts++;
      saveDB();

      lastReport = report;

      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text:
          "✅ *Broadcast Sent*\n\n" +
          `Total users: ${total}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "📦 View Delivery Report", callback_data: "report" }]
          ]
        }
      });

      pendingText = null;
      selectedBots.clear();
    }

    if (a === "report" && lastReport) {
      let t = "📦 *Delivery Report*\n\n";
      for (const k in lastReport) {
        t += `🤖 ${k}: ${lastReport[k]} users\n`;
      }
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        parse_mode: "Markdown",
        text: t
      });
    }

    if (a === "cancel") {
      pendingText = null;
      selectedBots.clear();
      await tg("sendMessage", {
        chat_id: OWNER_ID,
        text: "❌ Broadcast cancelled."
      });
    }
  }
});

app.listen(PORT, () =>
  console.log("✅ Master Bot LIVE on", PORT)
);
