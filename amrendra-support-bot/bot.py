from pyrogram import Client, filters
from pyrogram.types import InlineKeyboardMarkup, InlineKeyboardButton

# ===== Read config =====
try:
    from config import BOT_TOKEN, BOT_NAME, API_ID, API_HASH
except ImportError:
    BOT_TOKEN = ""
    BOT_NAME = "Amrendra Bot"
    API_ID = None
    API_HASH = None

# ===== Safety check =====
if not BOT_TOKEN or not API_ID or not API_HASH:
    raise RuntimeError("❌ BOT_TOKEN / API_ID / API_HASH missing in config.py")

# ===== Create bot client =====
app = Client(
    name="amrendra_support_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN
)

# ===== Texts =====
START_TEXT = (
    "👋 Welcome to {bot_name}\n\n"
    "This is the official support bot.\n"
    "Please choose an option below."
)

ABOUT_TEXT = (
    "🤖 {bot_name}\n\n"
    "This bot is built using a shared base template.\n"
    "Purpose: user support & assistance."
)

# ===== Buttons =====
MENU = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("ℹ️ About", callback_data="about")],
        [InlineKeyboardButton("🛠 Contact Owner", url="https://t.me/amrendra_support_bot")]
    ]
)

# ===== Handlers =====
@app.on_message(filters.command("start"))
async def start(client, message):
    await message.reply_text(
        START_TEXT.format(bot_name=BOT_NAME),
        reply_markup=MENU
    )

@app.on_callback_query()
async def callbacks(client, callback):
    if callback.data == "about":
        await callback.message.reply_text(
            ABOUT_TEXT.format(bot_name=BOT_NAME)
        )
    await callback.answer()

# ===== Run bot =====
print("✅ Amrendra Support Bot is running...")
