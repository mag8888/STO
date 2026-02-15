import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
const input = require("input");
import fs from "fs";

const API_ID = parseInt(process.env.TELEGRAM_API_ID || "0");
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const SESSION_FILE = "session.txt";

let client: TelegramClient;

export async function initClient() {
    console.log("Initializing GramJS Client...");

    let sessionString = "";
    if (fs.existsSync(SESSION_FILE)) {
        sessionString = fs.readFileSync(SESSION_FILE, "utf8");
    } else if (process.env.TELEGRAM_SESSION) {
        sessionString = process.env.TELEGRAM_SESSION;
    }

    const stringSession = new StringSession(sessionString);

    if (!API_ID || !API_HASH) {
        console.warn("⚠️  TELEGRAM_API_ID or TELEGRAM_API_HASH is missing. Bot listener will NOT start.");
        return null;
    }

    client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
    });

    try {
        await client.start({
            phoneNumber: async () => await input.text("Please enter your number: "),
            password: async () => await input.text("Please enter your password: "),
            phoneCode: async () => await input.text("Please enter the code you received: "),
            onError: (err) => console.log(err),
        });

        console.log("You should now be connected.");

        // Save session if new
        const newSession = client.session.save() as unknown as string;
        if (newSession !== sessionString) {
            fs.writeFileSync(SESSION_FILE, newSession);
            console.log("Session saved to", SESSION_FILE);
        }

    } catch (e) {
        console.error("Failed to start client:", e);
    }

    return client;
}

export function getClient() {
    return client;
}
