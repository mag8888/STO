
import { FastifyInstance } from 'fastify';

export async function shutdownServer(fastify: FastifyInstance) {
    console.log('Gracefully shutting down...');
    try {
        const { getBrowserInstance } = await import('./src/browser');
        const { browser } = getBrowserInstance();
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
        await fastify.close();
        process.exit(0);
    } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
    }
}
