import 'dotenv/config';
import Fastify from 'fastify';
import path from 'path';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { initClient, getClient, reconnectClient, getQR } from './client';
import { sendMessageToUser, sendDraftMessage, scanChatForLeads, ensureUserAndDialogue, saveMessageToDb, createDraftMessage } from './actions';
import { generateResponse } from './gpt';
import { startListener } from './listener';

const prisma = new PrismaClient();
const fastify = Fastify({ logger: true });

// Enable CORS
fastify.register(fastifyCors, { origin: true });

// Simple in-memory log buffer
const logBuffer: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function addToLog(type: string, args: any[]) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    // Strip ANSI codes
    const cleanMsg = msg.replace(/\u001b\[[0-9;]*m/g, '');
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    logBuffer.unshift(`[${timestamp}] [${type}] ${cleanMsg}`);
    if (logBuffer.length > 50) logBuffer.pop();
}

console.log = (...args) => {
    addToLog('INFO', args);
    originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
    addToLog('ERROR', args);
    originalConsoleError.apply(console, args);
};

fastify.get('/logs', async (req, reply) => {
    return logBuffer;
});

// Serve frontend
// fastify.register(fastifyStatic, {
//     root: path.join(__dirname, '../frontend/dist'),
//     prefix: '/',
// });

// Serve static files from public directory
fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/',
});

// Route root to admin_panel
fastify.get('/', (req, reply) => {
    reply.sendFile('admin_panel.html');
});

// API Routes

fastify.get('/messages', async (request, reply) => {
    try {
        const messages = await prisma.message.findMany({
            include: { dialogue: { include: { user: true } } },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        return { messages };
    } catch (error) {
        return reply.code(500).send({ error: 'Failed to fetch messages' });
    }
});

fastify.get('/dialogues', async (req, reply) => {
    try {
        const dialogues = await prisma.dialogue.findMany({
            where: { status: 'ACTIVE' },
            include: {
                user: true,
                messages: {
                    orderBy: { id: 'desc' },
                    take: 1
                }
            },
            orderBy: { updatedAt: 'desc' }
        });
        return dialogues;
    } catch (e) {
        return reply.code(500).send({ error: 'Failed to fetch dialogues' });
    }
});

fastify.post('/dialogues/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
        await prisma.dialogue.update({
            where: { id: Number(id) },
            data: { status: 'ARCHIVED' }
        });
        return { success: true };
    } catch (e) {
        return reply.code(500).send({ error: 'Failed' });
    }
});

fastify.get('/dialogues/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
        const dialogue = await prisma.dialogue.findUnique({
            where: { id: parseInt(id) },
            include: {
                user: true,
                messages: { orderBy: { createdAt: 'asc' } }
            }
        });
        console.log(`DEBUG: Dialogue ${id} result:`, dialogue ? 'Found' : 'Null');
        if (!dialogue) {
            console.log(`DEBUG: Dialogue ${id} is null, returning 404`);
            return reply.code(404).send({ error: 'Dialogue not found (null)' });
        }
        return dialogue;
    } catch (e) {
        console.error(`DEBUG: Error fetching dialogue ${id}:`, e);
        req.log.error(e);
        return reply.code(404).send({ error: 'Dialogue not found (exception)' });
    }
});

fastify.get('/status', async (request, reply) => {
    try {
        const client = getClient();

        let connected = false;
        let me = null;

        if (client && client.connected) {
            // Check if actually authorized
            connected = await client.isUserAuthorized();
            if (connected) {
                try { me = await client.getMe(); } catch (e) { }
            }
        }

        return { connected, me };
    } catch (err) {
        return { connected: false, error: err };
    }
});

fastify.post('/send', async (request, reply) => {
    const { username, message } = request.body as { username: string, message: string };
    if (!username || !message) return reply.code(400).send({ error: 'Missing fields' });

    try {
        // page is null
        await sendMessageToUser(null, username, message);
        return { success: true };
    } catch (e: any) {
        return reply.code(500).send({ error: e.message });
    }
});

// --- Knowledge Base Routes ---

fastify.get('/kb', async (req, reply) => {
    try {
        const items = await prisma.knowledgeItem.findMany({
            orderBy: { createdAt: 'desc' }
        });
        return items;
    } catch (e) { return []; }
});

fastify.post('/kb', async (req, reply) => {
    const { question, answer } = req.body as { question: string, answer: string };
    if (!question || !answer) return reply.code(400).send({ error: 'Missing fields' });
    try {
        const item = await prisma.knowledgeItem.create({
            data: { question, answer }
        });
        return item;
    } catch (e) { return reply.code(500).send(e); }
});

// Candidates
fastify.get('/kb/candidates', async (req, reply) => {
    try {
        const items = await prisma.learningCandidate.findMany({
            where: { status: 'PENDING' },
            orderBy: { createdAt: 'desc' }
        });
        return items;
    } catch (e) { return []; }
});

fastify.post('/kb/candidates/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
        // 1. Get candidate
        const candidate = await prisma.learningCandidate.findUnique({ where: { id: parseInt(id) } });
        if (!candidate) return reply.code(404).send({ error: 'Not found' });

        // 2. Create KB Item
        await prisma.knowledgeItem.create({
            data: {
                question: candidate.originalQuestion,
                answer: candidate.operatorAnswer
            }
        });

        // 3. Mark candidate as MERGED
        await prisma.learningCandidate.update({
            where: { id: parseInt(id) },
            data: { status: 'MERGED' }
        });

        return { success: true };
    } catch (e) { return reply.code(500).send(e); }
});

// --- Templates Routes ---
fastify.get('/templates', async (req, reply) => {
    // Mock templates for now, or add DB model if needed
    return [
        { id: 1, name: 'Greeting', content: 'Привет! Чем могу помочь?' },
        { id: 2, name: 'Services', content: 'Мы предлагаем услуги продвижения...' },
        { id: 3, name: 'Price', content: 'Наши цены начинаются от...' }
    ];
});

fastify.post('/messages/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { updatedText } = request.body as { updatedText?: string };

    try {
        const result = await sendDraftMessage(null, parseInt(id), updatedText);
        return result;
    } catch (err: any) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to approve message', details: err.message });
    }
});

fastify.put('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { firstName, lastName } = req.body as { firstName?: string, lastName?: string };

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { firstName, lastName }
        });
        return user;
    } catch (e) {
        return reply.code(500).send({ error: 'Failed to update user' });

    }
});

fastify.post('/users/:id/block', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
        await prisma.user.update({
            where: { id: parseInt(id) },
            data: { status: 'BLOCKED' }
        });
        return { success: true };
    } catch (e) {
        return reply.code(500).send({ error: 'Failed to block user' });
    }
});

fastify.post('/reconnect', async (req, reply) => {
    try {
        await reconnectClient();
        return { success: true };
    } catch (e) {
        req.log.error(e);
        return reply.code(500).send({ error: 'Reconnection failed' });
    }
});

fastify.get('/login-qr', async (req, reply) => {
    try {
        const token = getQR();

        // Detailed debugging
        const client = getClient();
        console.log(`[DEBUG] /login-qr requested. Client exists: ${!!client}, Connected: ${client?.connected}, Token available: ${!!token}`);

        if (client?.connected && await client.isUserAuthorized()) {
            return reply.send({ status: 'connected', message: 'Client is already connected and authorized! No QR needed.' });
        }
        if (!token) {
            // Check if client is even initialized
            if (!client) {
                return reply.code(503).send({ error: 'Client not initialized yet. Please wait.' });
            }
        }
        if (client.connected) {
            // Double check if authorized
            if (await client.isUserAuthorized()) {
                return reply.send({ status: 'connected', message: 'Client is already connected and authorized! No QR needed.' });
            }
        }
        // If connected but not authorized, and Token is null...
        // It means we might be waiting for QR generation callback?
        return reply.code(404).send({ error: 'QR code not generated yet. Please wait a few seconds and try again.' });
    }

        const QRCode = require('qrcode');

    // Convert to Base64URL (RFC 4648)
    // 1. Convert to standard Base64
    // 2. Replace "+" with "-"
    // 3. Replace "/" with "_"
    // 4. Remove padding "="
    const tokenBase64 = token.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const url = `tg://login?token=${tokenBase64}`;

    console.log(`[DEBUG] QR Code URL: ${url}`);

    const buffer = await QRCode.toBuffer(url, {
        scale: 10,
        margin: 4, // Increased margin for better scanning
        errorCorrectionLevel: 'Q' // Higher error correction (L, M, Q, H)
    });

    reply.type('image/png');
    return buffer;
} catch (e: any) {
    req.log.error(e);
    return reply.code(500).send({ error: 'Failed to generate QR', details: e.message });
}
});

fastify.post('/scan-chat', async (req, reply) => {
    const { chatLink, limit } = req.body as { chatLink: string, limit?: number };
    if (!chatLink) return reply.code(400).send({ error: 'Missing chatLink' });

    try {
        // Extract username from link if needed (e.g. t.me/username -> username)
        let username = chatLink.replace('https://t.me/', '').replace('@', '').split('/')[0];

        const leads = await scanChatForLeads(username, limit || 50);
        return leads;
    } catch (e: any) {
        req.log.error(e);
        return reply.code(500).send({ error: 'Scan failed', details: e.message });
    }
});

fastify.post('/scout/start', async (req, reply) => {
    const { username, name, context, accessHash } = req.body as { username: string, name: string, context: string, accessHash?: string };
    if (!username || !context) return reply.code(400).send({ error: 'Missing fields' });

    try {
        // 1. Create/Get User & Dialogue
        const { user, dialogue } = await ensureUserAndDialogue(username, name, accessHash);

        // 2. Save "Context" message (as if user sent it)
        // Check if last message is duplicate to avoid spamming if clicked multiple times
        const lastMsg = await prisma.message.findFirst({
            where: { dialogueId: dialogue.id },
            orderBy: { id: 'desc' }
        });

        if (!lastMsg || lastMsg.text !== context) {
            await saveMessageToDb(dialogue.id, 'USER', context, 'RECEIVED');
        }

        // 3. Generate Draft (AI)
        // Fetch brief history
        const recentMessages = await prisma.message.findMany({
            where: { dialogueId: dialogue.id },
            orderBy: { id: 'desc' },
            take: 5
        });

        const history = recentMessages.reverse().map(m => ({
            sender: m.sender,
            text: m.text
        }));

        const facts = (user.facts as any) || {};
        // const templates = {}; // Could fetch templates here
        // const kbItems: any[] = [];

        const stage = dialogue.stage || 'DISCOVERY';

        const gptResult = await generateResponse(
            history,
            stage as any,
            facts,
            {},
            []
        );

        if (gptResult) {
            await createDraftMessage(dialogue.id, gptResult.reply);
        }

        return { dialogueId: dialogue.id, user };

    } catch (e: any) {
        req.log.error(e);
        return reply.code(500).send({ error: 'Failed to start scouted chat', details: e.message });
    }
});

fastify.post('/messages/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { feedback } = req.body as { feedback: string };
    try {
        await prisma.message.update({
            where: { id: Number(id) },
            data: { feedback }
        });
        return { success: true };
    } catch (e) {
        return reply.code(500).send({ error: 'Failed' });
    }
});

fastify.post('/dialogues/:id/regenerate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { instructions } = req.body as { instructions?: string } || {};

    try {
        const dialogue = await prisma.dialogue.findUnique({
            where: { id: Number(id) },
            include: { user: true }
        });
        if (!dialogue) return reply.code(404).send({ error: 'Not found' });

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

        const facts = (dialogue.user.facts as any) || {};

        // Fetch Rules (Global + User specific)
        const rules = await prisma.rule.findMany({
            where: {
                OR: [
                    { isGlobal: true },
                    { userId: dialogue.userId }
                ],
                isActive: true
            }
        });

        const ruleStrings = rules.map(r => r.content);

        // Pass instructions and rules to GPT
        const gptResult = await generateResponse(
            history,
            dialogue.stage as any,
            facts,
            {},
            [],
            instructions, // <--- New Argument
            ruleStrings   // <--- Passed Rules
        );

        if (gptResult) {
            await createDraftMessage(dialogue.id, gptResult.reply);
            return { success: true };
        } else {
            return reply.code(500).send({ error: 'GPT failed to generate response' });
        }

    } catch (e: any) {
        req.log.error(e);
        return reply.code(500).send({ error: 'Failed' });
    }
});

// --- Rules Management ---

fastify.get('/rules', async (req, reply) => {
    const { userId } = req.query as { userId?: string };
    try {
        const where: any = { isActive: true };
        if (userId) {
            where.OR = [
                { isGlobal: true },
                { userId: Number(userId) }
            ];
        }
        const rules = await prisma.rule.findMany({ where, orderBy: { createdAt: 'desc' } });
        return rules;
    } catch (e) {
        return reply.code(500).send({ error: 'Failed to fetch rules' });
    }
});

fastify.post('/rules', async (req, reply) => {
    const { content, isGlobal, userId } = req.body as { content: string, isGlobal?: boolean, userId?: number };
    try {
        const rule = await prisma.rule.create({
            data: {
                content,
                isGlobal: isGlobal || false,
                userId: userId ? Number(userId) : null,
                isActive: true
            }
        });
        return rule;
    } catch (e) {
        return reply.code(500).send({ error: 'Failed to create rule' });
    }
});

fastify.delete('/rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
        await prisma.rule.delete({ where: { id: Number(id) } });
        return { success: true };
    } catch (e) {
        return reply.code(500).send({ error: 'Failed to delete rule' });
    }
});

// SPA Fallback - Disabled for Vanilla JS
// fastify.setNotFoundHandler((req, reply) => {
//     if (req.raw.url?.startsWith('/api')) {
//         reply.code(404).send({ error: 'Not Found' });
//     } else {
//         reply.sendFile('index.html');
//     }
// });

const start = async () => {
    try {
        console.log('Starting server...');
        await prisma.$connect();

        const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on http://0.0.0.0:${port}`);

        // Initialize GramJS
        await initClient();

        const client = getClient();
        if (client) {
            console.log("GramJS Client initialized. Starting listener...");
            startListener(null);
        }

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
