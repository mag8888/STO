import { NewMessage } from "telegram/events";
import { getClient } from "./client";
import { ensureUserAndDialogue, saveMessageToDb, createDraftMessage } from "./actions";
import { generateResponse } from "./gpt";
import { DialogueStage } from '@prisma/client'; // Removed PrismaClient
import prisma from './db'; // Use shared instance

// const prisma = new PrismaClient(); // Removed

export async function startListener(page: any) { // 'page' arg kept for compatibility but unused
    const client = getClient();
    if (!client) {
        console.error("Client not initialized, cannot start listener");
        return;
    }

    console.log("[Listener] Starting GramJS event listener...");

    client.addEventHandler(async (event: any) => {
        const message = event.message;
        const sender = await message.getSender();

        // Basic filters
        if (!sender || sender.bot || message.out) return; // Ignore bots and own messages for now (unless we want to track own)

        const username = sender.username || sender.id.toString();
        const firstName = sender.firstName || "Unknown";
        const text = message.text || "";

        console.log(`[Listener] New message from ${username}: ${text}`);

        // --- Ignore Triggers Check ---
        try {
            const triggers = await prisma.ignoreTrigger.findMany();
            const shouldIgnore = triggers.some(t => {
                if (t.type === 'USERNAME') {
                    return username.toLowerCase() === t.keyword.toLowerCase();
                }
                if (t.type === 'KEYWORD') {
                    return text.toLowerCase().includes(t.keyword.toLowerCase());
                }
                return false;
            });

            if (shouldIgnore) {
                console.log(`[Listener] Message ignored by trigger.`);
                return;
            }
        } catch (e) {
            console.error(`[Listener] Error checking triggers: ${e}`);
        }

        // Mark as read
        try {
            await message.markAsRead();
        } catch (e) {
            console.error(`[Listener] Failed to mark as read: ${e}`);
        }

        // 1. Save to DB
        const { user, dialogue } = await ensureUserAndDialogue(username, firstName);

        if (user.status === 'BLOCKED' || user.status === 'REJECTED') { // Added REJECTED check
            console.log(`[Listener] Ignoring message from BLOCKED/REJECTED user ${username}`);
            return;
        }

        await saveMessageToDb(dialogue.id, 'USER', text, 'RECEIVED');

        // 2. Generate AI Reply (Draft)
        // Fetch history
        const recentMessages = await prisma.message.findMany({
            where: { dialogueId: dialogue.id },
            orderBy: { id: 'desc' },
            take: 10
        });

        const history = recentMessages.reverse().map(m => ({
            sender: m.sender,
            text: m.text
        }));

        const currentStage = dialogue.stage as DialogueStage;
        const currentFacts = (user.facts as any) || {};

        // TODO: Load Templates & KB
        const templates = {};
        const kbItems: any[] = [];

        // Fetch Rules
        const rules = await prisma.rule.findMany({
            where: {
                OR: [
                    { isGlobal: true },
                    { userId: user.id }
                ],
                isActive: true
            }
        });
        const ruleStrings = rules.map(r => r.content);

        console.log(`[GPT] Generating reply for ${username}...`);
        const gptResult = await generateResponse(
            history,
            currentStage,
            user, // Changed from currentFacts
            templates,
            kbItems,
            undefined, // No custom instructions for auto-reply
            ruleStrings
        );

        if (gptResult) {
            console.log(`[GPT] Generated draft: ${gptResult.reply}`);
            await createDraftMessage(dialogue.id, gptResult.reply);

            // Update Profile Data
            if (gptResult.extractedProfile && Object.keys(gptResult.extractedProfile).length > 0) {
                console.log(`[Profile] Updating user ${user.username}:`, gptResult.extractedProfile);
                await prisma.user.update({
                    where: { id: user.id },
                    data: gptResult.extractedProfile
                });
            }

            // Update State
            if (gptResult.nextStage !== currentStage) {
                await prisma.dialogue.update({
                    where: { id: dialogue.id },
                    data: { stage: gptResult.nextStage }
                });
            }
            if (gptResult.newFacts && Object.keys(gptResult.newFacts).length > 0) {
                const updatedFacts = { ...currentFacts, ...gptResult.newFacts };
                await prisma.user.update({
                    where: { id: user.id },
                    data: { facts: updatedFacts }
                });
            }
        }

    }, new NewMessage({}));
}
