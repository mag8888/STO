import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';

puppeteer.use(StealthPlugin());

let browser: Browser | null = null;
let page: Page | null = null;

const USER_DATA_DIR = path.join(process.cwd(), 'session_data');

export async function initBrowser() {
    if (browser) return { browser, page };

    console.log(`[Browser] User Data Dir: ${USER_DATA_DIR}`);

    // Fix for "Profile in use" error in Docker/Railway
    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    try {
        // Check if file exists OR is a broken symlink
        let exists = false;
        try {
            const stats = fs.lstatSync(lockFile);
            exists = true; // It exists (file, dir, or symlink)
        } catch (e: any) {
            if (e.code !== 'ENOENT') console.error('[Browser] lstat failed:', e);
        }

        if (exists) {
            try {
                console.log('[Browser] Removing stale SingletonLock...');
                fs.unlinkSync(lockFile);
            } catch (e) {
                console.error('[Browser] Failed to remove SingletonLock:', e);
            }
        }
    } catch (e) {
        console.error('[Browser] Error during lock cleanup:', e);
    }

    console.log('[Browser] Launching puppeteer...');
    try {
        browser = await puppeteer.launch({
            headless: true,
            userDataDir: USER_DATA_DIR,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled',
                // Add these to help with persistence stability
                '--disable-infobars',
                '--start-maximized',
                '--profile-directory=Default'
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            dumpio: true,
        });
        console.log('[Browser] Puppeteer launched successfully.');
    } catch (e) {
        console.error('[Browser] Puppeteer launch failed:', e);
        throw e;
    }


    if (!browser) throw new Error('Failed to initialize browser');

    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Set viewport to a common resolution
    console.log('Browser launched. New page created.');

    // Forward console logs from the browser to the server terminal
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    page.on('requestfailed', request => console.error(`PAGE REQUEST FAILED: ${request.failure()?.errorText} ${request.url()}`));

    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Loading Telegram Web K...');
    try {
        // Go to Telegram Web K (Classic version, more stable)
        await page.goto('https://web.telegram.org/k/', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        console.log('Page loaded (networkidle0). Waiting for selector...');

        // Simulate human interaction
        try {
            await page.mouse.move(100, 100);
            await page.mouse.down();
            await page.mouse.up();
            await page.mouse.move(200, 200);
        } catch (e) { console.error('Mouse sim failed', e); }

        // Try to wait for key elements (QR canvas or chat list)
        try {
            console.log('Waiting for .chat-list or canvas...');
            await page.waitForSelector('.chat-list, .login_head_bg, canvas', { timeout: 30000 });
            console.log('Selector found!');
            // Add a small delay for rendering
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.log('Element wait timed out, proceeding to screenshot anyway');
            // Dump content to see what's there
            const content = await page.content();
            console.log('Page content length:', content.length);
        }
    } catch (err) {
        console.error('Navigation error:', err);
    }

    // Take a screenshot to check login status/QR code
    console.log('Taking screenshot...');
    const screenshotPath = path.join(process.cwd(), 'login_status.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}. Please scan QR code.`);

    return { browser, page };
}

export function getBrowserInstance() {
    return { browser, page };
}

export async function closeBrowser() {
    if (browser) {
        try {
            await Promise.race([
                browser.close(),
                new Promise(resolve => setTimeout(resolve, 3000)) // Force close after 3s
            ]);
        } catch (e) {
            console.error('Error closing browser:', e);
        }
        browser = null;
        page = null;
    }
}
