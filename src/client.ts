import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
// const input = require("input");
import fs from "fs";

const API_ID = parseInt(process.env.TELEGRAM_API_ID || "0");
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const SESSION_DIR = "session_data";
const SESSION_FILE = `${SESSION_DIR}/session.txt`;

// Ensure directory exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR);
}

let client: TelegramClient;
let currentQR: Buffer | null = null;

export function getQR() {
    return currentQR;
}

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
        // Use QR Code Login
        const qrcode = require('qrcode-terminal');
        console.log("[DEBUG] Connecting to Telegram servers...");

        // Timeout for connection
        const connectPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 15000));

        await Promise.race([connectPromise, timeoutPromise]);
        console.log("[DEBUG] Connected to Telegram servers.");

        // Start login flow in background (don't await) so server can start
        console.log("[DEBUG] Client connected. Requesting QR code...");
        client.signInUserWithQrCode(
            { apiId: API_ID, apiHash: API_HASH },
            {
                onError: (e) => console.log(e),
                qrCode: async (code) => {
                    console.log("Scan this QR code:");
                    currentQR = code.token;
                    qrcode.generate(code.token.toString('base64'), { small: true });
                }
            }
        ).then(async () => {
            console.log("You should now be connected.");
            currentQR = null; // Clear QR

            // Save session if new
            const newSession = client.session.save() as unknown as string;
            if (newSession !== sessionString) {
                fs.writeFileSync(SESSION_FILE, newSession);
                console.log("Session saved to", SESSION_FILE);
                console.log("\n⚠️  COPY THIS SESSION STRING FOR RAILWAY ENV (TELEGRAM_SESSION):");
                console.log(newSession);
                console.log("----------------------------------------------------------------\n");
            }
        }).catch(e => {
            console.error("Login failed:", e);
        });

    } catch (e) {
        console.error("Failed to start client:", e);
    }

    return client;
}


export async function reconnectClient() {
    console.log("Reconnecting client...");
    if (client) {
        try { await client.disconnect(); } catch (e) { console.error("Disconnect failed", e); }
    }
    await initClient();
    return true;
}

export function getClient() {
    return client;
}
