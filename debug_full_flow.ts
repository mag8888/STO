import 'dotenv/config';
import { initClient, getClient } from './src/client';
import { PrismaClient } from '@prisma/client';
import { generateResponse } from './src/gpt';

const prisma = new PrismaClient();

async function debugFlow() {
    console.log("=== STARTING DEBUG FLOW ===");

    // 1. Env Var Check
    console.log("\n[1] Checking Environment Variables:");
    console.log(`TELEGRAM_API_ID: ${process.env.TELEGRAM_API_ID ? 'OK' : 'MISSING'}`);
    console.log(`TELEGRAM_API_HASH: ${process.env.TELEGRAM_API_HASH ? 'OK' : 'MISSING'}`);
    console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'OK' : 'MISSING'}`);
    console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? 'OK' : 'MISSING'}`);

    // 2. Database Check
    console.log("\n[2] Checking Database Connection...");
    try {
        await prisma.$connect();
        const userCount = await prisma.user.count();
        console.log(`DB Connected. User count: ${userCount}`);

        // Find a valid user to test with
        const lastDialogue = await prisma.dialogue.findFirst({
            include: { user: true },
            orderBy: { updatedAt: 'desc' }
        });

        if (lastDialogue) {
            console.log(`Will use user @${lastDialogue.user.username} (ID: ${lastDialogue.user.telegramId}) for tests.`);
        } else {
            console.warn("No users found in DB to test with.");
        }

    } catch (e) {
        console.error("DB Connection FAILED:", e);
    }

    // 3. Telegram Connection Check
    console.log("\n[3] Checking Telegram Client...");
    try {
        const client = await initClient();
        if (client) {
            // Need to wait a bit for connection?
            console.log("Client initialized. Checking connection...");
            const connectPromise = client.connect();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 10000));
            await Promise.race([connectPromise, timeoutPromise]);

            if (client.connected) {
                console.log("Client CONNECTED.");

                const isAuth = await client.isUserAuthorized();
                console.log(`Is Authorized: ${isAuth}`);

                if (isAuth) {
                    try {
                        const me = await client.getMe();
                        console.log(`Logged in as: ${(me as any).firstName} (@${(me as any).username})`);

                        // Try sending to Saved Messages (Me)
                        console.log("Attempting to send message to 'me'...");
                        await client.sendMessage("me", { message: "Debug Test Message" });
                        console.log("Message sent to Saved Messages successfully.");
                    } catch (e: any) {
                        console.error("Failed to getMe or sendMessage:", e.message);
                    }
                } else {
                    console.error("Client is connected but NOT AUTHORIZED. Login required.");
                }

            } else {
                console.error("Client FAILED to connect (timeout or error).");
            }
        }
    } catch (e) {
        console.error("Telegram Client Init FAILED:", e);
    }

    // 4. GPT Generation Check
    console.log("\n[4] Checking OpenAI GPT...");
    try {
        // Mock data
        const mockUser: any = {
            id: 1,
            username: 'test_user',
            firstName: 'Test',
            facts: {},
            city: 'Nowhere'
        };
        const history = [{ sender: 'USER', text: 'Hello, testing connection.' }];

        const result = await generateResponse(
            history,
            'DISCOVERY',
            mockUser,
            {},
            []
        );

        if (result) {
            console.log("GPT Response Generated Successfully:", result.reply);
        } else {
            console.error("GPT returned NULL response.");
        }

    } catch (e: any) {
        console.error("GPT Generation FAILED:", e);
        if (e.response) {
            console.error("OpenAI API Error Data:", e.response.data);
        }
    }

    console.log("\n=== DEBUG FLOW COMPLETE ===");
    process.exit(0);
}

debugFlow();
