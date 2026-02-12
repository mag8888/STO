import Fastify from 'fastify';
import fs from 'fs';
import path from 'path';
import { initBrowser, closeBrowser, getBrowserInstance } from './browser';
import { sendMessageToUser, checkLogin, startDialogue } from './actions';
import prisma from './db';

const fastify = Fastify({ logger: true });

interface SendMessageBody {
    username: string;
    message: string;
}

interface StartDialogueBody {
    username: string;
    referrer: string;
    topic: string;
}

// Debug status
let browserStatus = 'not-started';

fastify.get('/', async (request, reply) => {
    return { status: 'ok', message: 'Telegram Simulator is running', browserStatus };
});

fastify.get('/reload', async (request, reply) => {
    const { page } = getBrowserInstance();
    if (!page) return reply.code(500).send({ error: 'Browser not initialized' });

    try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        return { success: true, message: 'Page reloaded' };
    } catch (e) {
        return reply.code(500).send({ error: 'Reload failed', details: (e as Error).message });
    }
});

fastify.get('/screen', async (request, reply) => {
    const { page } = getBrowserInstance();
    if (!page) {
        return reply.code(500).send({ error: 'Browser not initialized' });
    }

    try {
        const screenshotPath = path.join(process.cwd(), 'current_screen.png');
        await page.screenshot({ path: screenshotPath });

        const stream = fs.createReadStream(screenshotPath);
        return reply.type('image/png').send(stream);
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to take screenshot', details: (err as Error).message });
    }
});

fastify.get('/login-qr', async (request, reply) => {
    // Refresh screenshot if page is available
    const { page } = getBrowserInstance();
    if (page) {
        try {
            await page.screenshot({ path: path.join(process.cwd(), 'login_status.png') });
        } catch (e) {
            console.error("Failed to refresh login screenshot:", e);
        }
    }

    const imagePath = path.join(process.cwd(), 'login_status.png');
    if (fs.existsSync(imagePath)) {
        const stream = fs.createReadStream(imagePath);
        return reply.type('image/png').send(stream);
    } else {
        // Debug: List files in current directory to see what's going on
        const files = fs.readdirSync(process.cwd());
        return reply.code(404).send({
            error: 'QR code not found yet.',
            browserStatus,
            cwd: process.cwd(),
            files: files.filter(f => f.endsWith('.png') || f.endsWith('.json')),
            message: 'Browser might still be initializing or failed.'
        });
    }
});

fastify.get('/messages', async (request, reply) => {
    try {
        const messages = await prisma.message.findMany({
            include: {
                dialogue: {
                    include: {
                        user: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        return { messages };
    } catch (error) {
        return reply.code(500).send({ error: 'Failed to fetch messages' });
    }
});

fastify.post<{ Body: SendMessageBody }>('/send', async (request, reply) => {
    const { username, message } = request.body;

    if (!username || !message) {
        return reply.code(400).send({ error: 'Username and message are required' });
    }

    const { page } = await initBrowser();

    if (!page) {
        return reply.code(500).send({ error: 'Browser not initialized' });
    }

    try {
        const isLoggedIn = await checkLogin(page);
        if (!isLoggedIn) {
            // Try to reload to see if it fixes it
            await page.reload({ waitUntil: 'networkidle0' });
            const stillLoggedIn = await checkLogin(page);
            if (!stillLoggedIn) {
                return reply.code(401).send({ error: 'Telegram not logged in. Please check the browser window.' });
            }
        }

        await sendMessageToUser(page, username, message);
        return { success: true, message: `Sent to @${username}` };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to send message', details: (err as Error).message });
    }
});

fastify.post<{ Body: StartDialogueBody }>('/start-dialogue', async (request, reply) => {
    const { username, referrer, topic } = request.body;

    if (!username || !referrer || !topic) {
        return reply.code(400).send({ error: 'Username, referrer, and topic are required' });
    }

    const { page } = await initBrowser();

    if (!page) {
        return reply.code(500).send({ error: 'Browser not initialized' });
    }

    try {
        const isLoggedIn = await checkLogin(page);
        if (!isLoggedIn) {
            return reply.code(401).send({ error: 'Telegram not logged in. Please check the browser window.' });
        }

        const result = await startDialogue(page, username, referrer, topic);
        return result;
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to start dialogue', details: (err as Error).message });
    }
});


const start = async () => {
    try {
        console.log('Starting server and browser...');
        // Verify DB connection
        await prisma.$connect();
        console.log('Connected to Database');

        const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on http://0.0.0.0:${port}`);

        // Initialize browser after server is up to avoid deployment timeouts
        browserStatus = 'initializing';
        initBrowser().then(async ({ page }) => {
            console.log('Browser initialized successfully');
            browserStatus = 'ready';

            // Start message listener
            if (page) {
                const { startListener } = await import('./listener');
                startListener(page);
                console.log('Message listener started');
            }
        }).catch(err => {
            console.error('Failed to initialize browser:', err);
            browserStatus = 'failed: ' + err.message;
        });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await closeBrowser();
    await prisma.$disconnect();
    process.exit(0);
});

start();
