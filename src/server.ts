import Fastify from 'fastify';
import { initBrowser, closeBrowser } from './browser';
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
        initBrowser().then(() => {
            console.log('Browser initialized successfully');
        }).catch(err => {
            console.error('Failed to initialize browser:', err);
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
