
import { initBrowser, closeBrowser } from './src/browser';
import { checkLogin } from './src/actions';

async function main() {
    try {
        console.log('Initializing browser...');
        const { page } = await initBrowser();
        if (!page) throw new Error('No page initialized');

        console.log('Checking login status...');
        const isLoggedIn = await checkLogin(page);
        console.log(`LOGIN_STATUS: ${isLoggedIn ? 'LOGGED_IN' : 'NOT_LOGGED_IN'}`);

        if (isLoggedIn) {
            console.log('Login confirmed.');

            // List available chats
            console.log('Scanning for available chats...');
            await page.waitForSelector('.chat-list', { timeout: 5000 }).catch(() => console.log('Chat list not found immediately.'));

            const chats = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('.chat-list .peer-title'));
                return elements.map(el => el.textContent?.trim()).filter(t => t);
            });

            console.log('Available chats:', chats.slice(0, 10)); // Show top 10
        } else {
            console.log('Login failed / QR code active.');
        }

        await page.screenshot({ path: 'login_check.png' });
        console.log('Took screenshot: login_check.png');

    } catch (error) {
        console.error('Error during check:', error);
    } finally {
        await closeBrowser();
    }
}

main();
