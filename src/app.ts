import { Context, Telegraf } from "telegraf";
import { Update } from "typegram";

import dotenv from "dotenv";
import { exec, spawn } from "child_process";
import {
    createReadStream,
    existsSync,
    mkdirSync,
    readdir,
    readdirSync,
    readFileSync,
    rmdirSync,
    rmSync,
} from "fs";

dotenv.config();

const bot: Telegraf<Context<Update>> = new Telegraf(
    process.env.BOT_TOKEN as string
);

// keep a counter of the number of concurrents by each user, to prevent them from spamming
const tracker: { [id: string]: number } = {};

// Declare the score directory
const rootDir = `${process.cwd()}/scores`;

// create if not exists
if (!existsSync(rootDir)) {
    mkdirSync(rootDir);
}

bot.start((ctx) => {
    ctx.reply(
        `Hello ${ctx.from.first_name}! \n\nSend me any valid MuseScore link to download.`
    );
});

bot.command('reset', (ctx) => {
    tracker[ctx.from.id] = 0;
    ctx.reply('Reset triggered. Try doing what you were doing again.');
})

bot.on("text", async (ctx) => {
    try {
        const link = ctx.message?.text;

        // Validate the URL
        if (link.includes("official_scores")) {
            return ctx.reply("Sorry, official scores cannot be downloaded at this time.")
        }

        const regex = /musescore.com\/user\/[0-9]+\/scores\/[0-9]+/gm;
        if (!regex.test(link)) {
            return ctx.reply("Invalid link. Please send a valid MuseScore link.");
        }

        // Check if the user has exceeded the limit
        if (tracker[ctx.from.id] > 2) {
            ctx.reply(
                "Your simulateneous download limit of 3 has been reached. Please try again later when the current files have finished downloading.\n\nNot actually downloading anything? Type /reset to reset the bot, then try again."
            );
            return;
        }

        // Increment the counter
        tracker[ctx.from.id] = tracker[ctx.from.id]
            ? tracker[ctx.from.id] + 1
            : 1;

        // Send message to user to tell them of the progress
        const msg = await ctx.reply(
            `Your link has been received. Please wait...\n\n⏳ Loading score from MuseScore...`,
            {
                reply_to_message_id: ctx.message.message_id,
            }
        );

        const shell = spawn("node", ["./msdl/dl-librescore/dist/cli.js"], {
            cwd: process.cwd(),
        });

        // Keep track of which stage we are in
        let status = 0;

        // Make the directories to store the files

        const timestamp = Date.now();
        mkdirSync(`${rootDir}/${timestamp}`);
        const dir = `${rootDir}/${timestamp}`;

        // Placeholder variable for the score title
        let scoreTitle = "";

        shell.stdout.on("data", function (data) {
            console.log({data: data.toString()});
            console.log("-------------------------------");
            if (data.toString() === "\x1B[2D\x1B[2C" && status === 0) {
                // 'Please input a valid musescore URL'
                console.log(`Please input a valid musescore URL\n${link}`);
                status = 1;
                shell.stdin.write(link + "\n");
            }

            if (
                (data.toString().endsWith("(Y/n) \x1B[18D\x1B[18C") ||
                    data.toString() === "\x1B[18C") &&
                status === 1
            ) {
                // Continue?

                status = 2;

                const matchedTitle = data
                    .toString()
                    .match(/(?<=Title:)(.*)(?=)/gm);
                if (matchedTitle) {
                    scoreTitle = matchedTitle[0].trim();
                    ctx.telegram.editMessageText(
                        ctx.chat.id,
                        msg.message_id,
                        undefined,
                        `Your link has been received. Please wait...\n\n✅ Found score: ${scoreTitle}\n⏳ Downloading files...`
                    );
                }
                console.log(`Continue (y/n)`);
                shell.stdin.write("\n");
            }

            if (
                (data.toString().endsWith("pdf\x1B[8D\x1B[8C") ||
                    data.toString() === "\x1B[8C" ||
                    data.toString() === "\x1B[8D\x1B[8C") &&
                status === 2
            ) {
                // there's no way to write arrow keys, so for now, we will just download all
                shell.stdin.write(" ");
                status = 3;
                shell.stdin.write("i" + "\n");
                console.log(`Selecting all files to download`);
                // shell.stdin.write("\n")
            }

            if (
                (data.toString().endsWith("\x1B[58D\x1B[58C") ||
                    data.toString() === "\x1B[8C" ||
                    data.toString() === "\x1B[58C") &&
                status === 3
            ) {
                status = 4;
                shell.stdin.write(dir);
                shell.stdin.write("\n");

                // files downloaded
                
                shell.stdin.end();
            }
        });

        shell.on("close", () => {
            console.log("shell closed");
            if (!scoreTitle) {
                return ctx.telegram.editMessageText(
                    ctx.chat.id,
                    msg.message_id,
                    undefined,
                    `Invalid link. Please send a valid MuseScore link.`
                );
            }
            ctx.telegram.editMessageText(
                ctx.chat.id,
                msg.message_id,
                undefined,
                `Your link has been received. Please wait...\n\n✅ Found score: ${scoreTitle}\n✅ Files downloaded. \n⏳ Sending files to you, please be patient as this can take some time...`
            );
            console.log(`Files downloaded. Sending to user`);

            readdir(dir, (err, files) => {
                if (err) console.log(err);

                console.log(files);
                if (!files || !files.length) {
                    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "Sorry, there was an unexpected error. Please send me the link again.\n\nIf this error persists, please try again later.")
                    return
                }
                ctx.sendChatAction("upload_document")
                const promises = files.map((file) => {
                    return ctx.telegram.sendDocument(
                        ctx.from.id,
                        {
                            source: readFileSync(`${dir}/${file}`),
                            filename: file,
                        },
                        {
                            reply_to_message_id: ctx.message.message_id,
                        }
                    );
                });

                Promise.all(promises)
                    .then(() => {
                        console.log("done");
                        // delete the folder with the items in it
                        rmSync(dir, {
                            recursive: true,
                            force: true,
                        });

                        ctx.telegram.editMessageText(
                            ctx.chat.id,
                            msg.message_id,
                            undefined,
                            `Your link has been received. Please wait...\n\n✅ Found score: ${scoreTitle}\n✅ Files downloaded. \n✅ Sent files to you.`
                        );

                        // Decrement the counter
                        tracker[ctx.from.id] = tracker[ctx.from.id] - 1;
                    })
                    .catch(console.log);
            });
        });
    } catch (e) {
        console.log(e);
    }
});



bot.launch().then(() => {
    console.log("Bot is running!");
});

// custom function to catch message errors
const messageErrorHandler = (e: any) => console.log(e);


// Enable graceful stop
const shutDown = () => {
    rmSync(rootDir, {
        recursive: true,
        force: true,
    });
};

process.once("SIGINT", () => {
    shutDown();
    bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
    shutDown();
    bot.stop("SIGTERM");
});

process.on("uncaughtException", (e) => {
    shutDown();
    console.log(e);
});
process.on("unhandledRejection", (e) => {
    shutDown();
    console.log(e);
});
process.on("warning", (e) => {
    shutDown();
    console.log(e);
});
process.on("error", (e) => {
    shutDown();
    console.log(e);
});
