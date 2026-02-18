import { Api } from "telegram";
import { getClient } from "./client";
import { PrismaClient, MessageStatus, MessageSender } from '@prisma/client';

const prisma = new PrismaClient();

// --- DB Helpers ---

// --- DB Helpers ---

export async function ensureUserAndDialogue(username: string, name: string, accessHash?: string, source: 'INBOUND' | 'SCOUT' = 'INBOUND') {
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
                status: 'ACTIVE',
                source: source // Use provided source
            }
        });
        console.log(`[DB] Created new dialogue for user: ${username} (Source: ${source})`);
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

// Refactored to use userId and GramJS directly
export async function sendMessageToUser(userId: number, text: string) {
    console.log(`[ACTION] sendMessageToUser called for userId: ${userId}`);
    const client = getClient();
    if (!client || !client.connected) {
        console.error('[ACTION] Client not connected');
        throw new Error('Telegram client not connected');
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error(`User ID ${userId} not found`);
        console.log(`[ACTION] Found user in DB: ${user.telegramId} (@${user.username})`);

        // 1. Create Message Record First (Optimistic)
        // Find dialogue ID
        const dialogue = await prisma.dialogue.findFirst({ where: { userId } });
        const dialogueId = dialogue?.id || 0;

        const msg = await prisma.message.create({
            data: {
                dialogueId,
                sender: 'OPERATOR',
                text,
                status: 'SENT'
            }
        });

        // Update Dialogue LastUpdated timestamp to fix sorting
        await prisma.dialogue.update({
            where: { id: dialogueId },
            data: { updatedAt: new Date() }
        });

        console.log(`[ACTION] Created DB message: ${msg.id}`);

        // 2. Send via GramJS
        // Use telegramId (string) or username
        const target = user.telegramId;
        console.log(`[ACTION] Sending via GramJS to ${target}...`);

        await client.sendMessage(target, { message: text });
        console.log(`[ACTION] GramJS send successful`);

        return msg;
    } catch (e: any) {
        console.error('[ACTION] Failed to send message:', e);
        throw e;
    }
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
// --- Scouting ---
export async function scanChatForLeads(chatUsername: string, limit: number = 50) {
    console.log(`[Scout] Scanning ${chatUsername} for leads (limit: ${limit})...`);
    const client = getClient();
    if (!client || !client.connected) throw new Error('Client not connected');

    try {
        const messages = await client.getMessages(chatUsername, { limit: limit });
        const leads: any[] = [];

        // Broader Networking Keywords
        const keywords = [
            // Requests
            'ищу', 'нужен', 'надо', 'подскажите', 'куплю', 'заказать', 'help', 'need', 'want', 'клиент', 'трафик',
            // Offers / Intros
            'занимаюсь', 'работаю', 'проект', 'всем привет', 'меня зовут', 'разработчик', 'маркетолог', 'таргетолог', 'дизайнер', 'предлагаю', 'могу',
            // Context
            'сотрудничество', 'партнерство', 'нетворкинг', 'знакомство', 'бизнес'
        ];

        // Fetch admins to check statuses (optimization: fetch once)
        // Note: getting participants might be restricted in some channels/groups.
        // We will try to check sender properties first.

        for (const msg of messages) {
            if (!msg.message || !msg.sender) continue;

            // Skip bots and self
            const senderInfo = msg.sender as any;
            if (senderInfo.bot || msg.out) continue;

            const text = msg.message.toLowerCase();
            const isMatch = keywords.some(k => text.includes(k));

            if (isMatch) {
                const sender = await msg.getSender() as any;
                if (!sender) continue;

                // Attempt to detect Admin
                // In GramJS/TL, ChannelParticipantAdmin or Creator has rights.
                // However, fetching participant info for every user might be slow/rate-limited.
                // We'll rely on what's available or try to fetch participant info if critical.
                // For now, let's check simple flags if available, or defaulting to false.
                let isAdmin = false;
                try {
                    // This is a "heavy" call if done per message. 
                    // Optimization: In a real app, we'd cache this or fetch all admins upfront.
                    // For now, we'll try to peek at the participant record if possible, or just skip.
                    // Actually, 'sender' object usually doesn't have admin info relative to chat. 
                    // We need 'getPermissions' or 'getParticipant'.
                    // Let's try to fetch participant info for this specific user in this specific chat.
                    const participant = await client.invoke(
                        new Api.channels.GetParticipant({
                            channel: chatUsername,
                            participant: sender.id
                        })
                    );

                    const p = (participant as any).participant;
                    if (p && (p.className === 'ChannelParticipantAdmin' || p.className === 'ChannelParticipantCreator')) {
                        isAdmin = true;
                    }
                } catch (e) {
                    // Fails if not a channel/supergroup or no permissions to view participants
                    // console.log('Checking admin failed:', e);
                }

                leads.push({
                    text: msg.message,
                    date: msg.date,
                    isAdmin: isAdmin,
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

        // Update DB Count
        // We need to find the ScannedChat by username/link. 
        // Since we only have 'chatUsername', we try to find a match.
        // Optimization: Pass ID instead of username? Or just findFirst.
        await prisma.scannedChat.updateMany({
            where: {
                OR: [
                    { username: chatUsername },
                    { link: { contains: chatUsername } }
                ]
            },
            data: { lastLeadsCount: leads.length, scannedAt: new Date() }
        });

        return leads;

    } catch (e: any) {
        console.error(`[Scout] Search failed: ${e.message}`);
        throw e;
    }
}
