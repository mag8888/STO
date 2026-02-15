import 'dotenv/config';
import { initClient, getClient } from "./src/client";

async function main() {
    console.log("Initializing...");
    await initClient();
    const client = getClient();

    if (!client) {
        console.error("Client failed");
        return;
    }

    try {
        console.log("Sending message...");
        await client.sendMessage("roman_arctur", { message: "Привет, это тестовый диалог от моего ИИ ассистента." });
        console.log("Message sent!");
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

main();
