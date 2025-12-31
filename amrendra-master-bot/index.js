if (update.callback_query) {
  const a = update.callback_query.data;

  // 1️⃣ SYSTEM STATUS (NO UI EDIT)
  if (a === "status") {
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "Markdown",
      text: getSystemStatus()
    });
    return;
  }

  // 2️⃣ SELECT ALL
  if (a === "select_all") {
    pendingBots = new Set(BOT_TOKENS.map((_, i) => i));

    await tg("editMessageReplyMarkup", {
      chat_id: OWNER_ID,
      message_id: update.callback_query.message.message_id,
      reply_markup: botKeyboard()
    });
    return;
  }

  // 3️⃣ TOGGLE BOT
  if (a.startsWith("toggle:")) {
    const i = Number(a.split(":")[1]);
    pendingBots.has(i)
      ? pendingBots.delete(i)
      : pendingBots.add(i);

    await tg("editMessageReplyMarkup", {
      chat_id: OWNER_ID,
      message_id: update.callback_query.message.message_id,
      reply_markup: botKeyboard()
    });
    return;
  }

  // 4️⃣ SEND
  if (a === "send") {
    const count = await broadcast(pendingText, [...pendingBots]);
    pendingText = null;
    pendingBots.clear();

    await tg("sendMessage", {
      chat_id: OWNER_ID,
      parse_mode: "Markdown",
      text:
        count === 0
          ? "⚠️ No eligible users found."
          : `✅ Broadcast delivered to *${count} users*.`
    });
    return;
  }

  // 5️⃣ CANCEL
  if (a === "cancel") {
    pendingText = null;
    pendingBots.clear();

    await tg("sendMessage", {
      chat_id: OWNER_ID,
      text: "❌ Broadcast cancelled."
    });
    return;
  }

  // 6️⃣ STOP
  if (a === "stop") {
    emergencyStop = true;
    await tg("sendMessage", {
      chat_id: OWNER_ID,
      text: "🛑 Emergency stop activated."
    });
    return;
  }
}
