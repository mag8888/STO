import 'dotenv/config';
import Fastify from 'fastify';
import path from 'path';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';

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

fastify.get('/dialogues', async (request, reply) => {
    try {
        const dialogues = await prisma.dialogue.findMany({
            where: { status: 'ACTIVE' },
            include: {
                user: true,
                messages: { orderBy: { createdAt: 'desc' }, take: 1 }
            },
            orderBy: { updatedAt: 'desc' }
        });
        return dialogues;
    } catch (e) {
        request.log.error(e);
        return [];
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
        return dialogue;
    } catch (e) {
        return reply.code(404).send({ error: 'Dialogue not found' });
    }
});

fastify.get('/status', async (request, reply) => {
    try {
        const { getClient } = await import('./client');
        const client = getClient();
        const connected = client ? client.connected : false;
        let me = null;
        if (connected) {
            // Basic cache or fetch
            try { me = await client.getMe(); } catch (e) { }
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
        const { sendMessageToUser } = await import('./actions');
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
        const { sendDraftMessage } = await import('./actions');
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

fastify.post('/scan-chat', async (req, reply) => {
    const { chatLink, limit } = req.body as { chatLink: string, limit?: number };
    if (!chatLink) return reply.code(400).send({ error: 'Missing chatLink' });

    try {
        const { scanChatForLeads } = await import('./actions');
        // Extract username from link if needed (e.g. t.me/username -> username)
        let username = chatLink.replace('https://t.me/', '').replace('@', '').split('/')[0];

        const leads = await scanChatForLeads(username, limit || 50);
        return leads;
    } catch (e: any) {
        req.log.error(e);
        return reply.code(500).send({ error: 'Scan failed', details: e.message });
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
        const { initClient } = await import('./client');
        await initClient();

        const client = await import('./client').then(m => m.getClient());
        if (client) {
            console.log("GramJS Client initialized. Starting listener...");
            const { startListener } = await import('./listener');
            startListener(null);
        }

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
