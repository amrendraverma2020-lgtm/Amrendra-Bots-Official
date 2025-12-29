from pyrogram import Client, filters
from pyrogram.types import InlineKeyboardMarkup, InlineKeyboardButton
import os

# Read config (per-bot identity)
try:
    from config import BOT_TOKEN, BOT_NAME
except ImportError:
    BOT_TOKEN = ""
    BOT_NAME = "Amrendra Bot"

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is empty. Set it in config.py for the actual bot.")

app = Client(
    name="amrendra_base_bot",
    bot_token=BOT_TOKEN
)

START_TEXT = (
    "👋 Welcome to *{bot_name}*\n\n"
    "This bot is powered by Amrendra base template.\n"
    "Choose an option below."
)

MENU = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("ℹ️ About", callback_data="about")],
        [InlineKeyboardButton("🛠 Support", callback_data="support")]
    ]
)

@app.on_message(filters.command("start"))
async def start(client, message):
    await message.reply_text(
        START_TEXT.format(bot_name=BOT_NAME),
        parse_mode="markdown",
        reply_markup=MENU
    )

@app.on_callback_query()
async def callbacks(client, callback):
    if callback.data == "about":
        await callback.message.reply_text(
            f"🤖 *{BOT_NAME}*\n\n"
            "This bot runs on a shared base template.\n"
            "Logic is common, identity is unique.",
            parse_mode="markdown"
        )
    elif callback.data == "support":
        await callback.message.reply_text(
            "🛠 For support, please contact the owner.",
            parse_mode="markdown"
        )
    await callback.answer()

print("✅ Base template logic loaded")
app.run()
