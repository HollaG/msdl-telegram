import { Context, Telegraf } from "telegraf";
import { Update } from "typegram";

import dotenv from "dotenv";

dotenv.config();


const bot: Telegraf<Context<Update>> = new Telegraf(
    process.env.BOT_TOKEN as string
);

bot.start((ctx) => {
    ctx.reply("Hello " + ctx.from.first_name + "!");
});


bot.launch().then(() => console.log("Bot is running!"));

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

process.on("uncaughtException", console.log);
process.on("unhandledRejection", console.log);
process.on("warning", console.log);
process.on("error", console.log);
