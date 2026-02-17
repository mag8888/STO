import { Api } from "telegram";
import { getClient } from "./client";
import { PrismaClient, MessageStatus, MessageSender } from '@prisma/client';

const prisma = new PrismaClient();

// --- DB Helpers ---

// --- DB Helpers ---

export async function ensureUserAndDialogue(username: string, name: string, accessHash?: string) {
    // 1. Find or Create User
    let user = await prisma.user.findFirst({
        where: { telegramId: username }
    });

    if (!user) {
        user = await prisma.user.create({
            data: {
                telegramId: username,
                username: username,
                firstName: name,
                status: 'LEAD',
                accessHash: accessHash || null
            }
        });
        console.log(`[DB] Created new user: ${username}`);
    } else {
        // Update info if changed
        const dataToUpdate: any = {};
        if (user.firstName !== name) dataToUpdate.firstName = name;
        if (user.username !== username) dataToUpdate.username = username;
        if (accessHash && user.accessHash !== accessHash) dataToUpdate.accessHash = accessHash;

        if (Object.keys(dataToUpdate).length > 0) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: dataToUpdate
            });
        }
    }

    // 2. Find or Create Active Dialogue
    let dialogue = await prisma.dialogue.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' }
    });

    if (!dialogue) {
        dialogue = await prisma.dialogue.create({
            data: {
                userId: user.id,
                status: 'ACTIVE'
            }
        });
        console.log(`[DB] Created new dialogue for user: ${username}`);
    }

    return { user, dialogue };
}

export async function saveMessageToDb(dialogueId: number, sender: MessageSender, text: string, status: MessageStatus = 'SENT') {
    try {
        const [msg] = await prisma.$transaction([
            prisma.message.create({
                data: {
                    dialogueId,
                    sender,
                    text,
                    status
                }
            }),
            prisma.dialogue.update({
                where: { id: dialogueId },
                data: { updatedAt: new Date() }
            })
        ]);

        console.log(`[DB] Saved ${sender} message: "${text.substring(0, 20)}..."`);
        return msg;
    } catch (e) {
        console.error(`[DB] Failed to save message: ${e}`);
        return null;
    }
}

// --- Actions ---

export async function sendDraftMessage(page: any, messageId: number, customText?: string) {
    console.log(`[Msg] Processing message ${messageId} via Userbot...`);
    const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { dialogue: { include: { user: true } } }
    });

    if (!message || !message.dialogue || !message.dialogue.user) {
        throw new Error('Message or User not found');
    }

    const username = message.dialogue.user.telegramId || message.dialogue.user.username; // Use telegramId as primary identifier if available
    const accessHash = message.dialogue.user.accessHash;

    if (!username) throw new Error('User has no username/ID');

    // Check if client is connected
    const client = getClient();
    if (!client || !client.connected) {
        throw new Error('Userbot client is not connected!');
    }

    const text = customText || message.text;

    try {
        let peer: any = username;

        // Use InputPeerUser if we have accessHash and it looks like an ID
        if (accessHash && /^\d+$/.test(username)) {
            // We need to construct InputPeerUser
            // GramJS Api is imported at top
            const userId = BigInt(username) as any;
            const hash = BigInt(accessHash) as any;
            peer = new Api.InputPeerUser({ userId, accessHash: hash });
            console.log(`[Msg] Sending to ID ${username} with AccessHash...`);
        } else {
            console.log(`[Msg] Sending to @${username}: "${text}"`);
        }

        await client.sendMessage(peer, { message: text });
        console.log(`[Msg] Sent approved message to ${username}`);

        // Update DB Status
        return await prisma.message.update({
            where: { id: messageId },
            data: {
                status: 'SENT',
                createdAt: new Date(),
                text: text
            }
        });

    } catch (e: any) {
        console.error(`[Msg] Failed to send message: ${e.message}`);
        throw e;
    }
}

export async function sendMessageToUser(page: any, username: string, text: string) {
    console.log(`[Msg] Sending direct message to @${username}...`);
    const client = getClient();
    if (!client || !client.connected) throw new Error('Client not connected');

    await client.sendMessage(username, { message: text });

    const { dialogue } = await ensureUserAndDialogue(username, username);
    await saveMessageToDb(dialogue.id, 'SIMULATOR', text, 'SENT');
}

export async function createDraftMessage(dialogueId: number, text: string) {
    const [msg] = await prisma.$transaction([
        prisma.message.create({
            data: {
                dialogueId,
                sender: 'SIMULATOR', // Keep legacy enum for now
                text,
                status: MessageStatus.DRAFT
            }
        }),
        prisma.dialogue.update({
            where: { id: dialogueId },
            data: { updatedAt: new Date() }
        })
    ]);
    return msg;
}

// Stubs for compatibility
export async function openChat(page: any, username: string) { return username; }
export async function checkLogin(page: any) { return true; }
export async function startDialogue(page: any, username: string) { }

// --- Scouting ---
export async function scanChatForLeads(chatUsername: string, limit: number = 50) {
    console.log(`[Scout] Scanning ${chatUsername} for leads (limit: ${limit})...`);
    const client = getClient();
    if (!client || !client.connected) throw new Error('Client not connected');

    try {
        const messages = await client.getMessages(chatUsername, { limit: limit });
        const leads: any[] = [];

        // Simple Keywords for "Request"
        const keywords = ['ищу', 'нужен', 'надо', 'подскажите', 'куплю', 'заказать', 'help', 'need', 'want', 'клиент', 'трафик'];

        for (const msg of messages) {
            if (!msg.message || !msg.sender) continue;

            // Skip bots and self (approximate)
            const senderInfo = msg.sender as any;
            if (senderInfo.bot || msg.out) continue;

            const text = msg.message.toLowerCase();
            const isMatch = keywords.some(k => text.includes(k));

            if (isMatch) {
                const sender = await msg.getSender() as any; // Ensure we get full info if possible
                if (!sender) continue;

                leads.push({
                    text: msg.message,
                    date: msg.date,
                    sender: {
                        id: sender.id.toString(),
                        username: sender.username,
                        firstName: sender.firstName,
                        lastName: sender.lastName,
                        accessHash: sender.accessHash ? sender.accessHash.toString() : null
                    }
                });
            }
        }

        console.log(`[Scout] Found ${leads.length} potential leads.`);
        return leads;

    } catch (e: any) {
        console.error(`[Scout] Search failed: ${e.message}`);
        throw e;
    }
}
