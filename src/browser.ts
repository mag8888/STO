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

    // Fix for "Profile in use" error in Docker/Railway
    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    try {
        // existsSync returns false for broken symlinks, so we use lstatSync
        if (fs.existsSync(USER_DATA_DIR)) {
            // Try to unlink SingletonLock directly
            try {
                if (fs.lstatSync(lockFile).isSymbolicLink() || fs.existsSync(lockFile)) {
                    console.log('Removing stale SingletonLock...');
                    fs.unlinkSync(lockFile);
                }
            } catch (e: any) {
                if (e.code !== 'ENOENT') console.error('Failed to check/remove SingletonLock:', e);
            }

            // Also remove other Singleton files
            const otherLocks = ['SingletonCookie', 'SingletonSocket'];
            for (const file of otherLocks) {
                try {
                    const p = path.join(USER_DATA_DIR, file);
                    if (fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) {
                        fs.unlinkSync(p);
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        console.error('Error during lock cleanup:', e);
    }

    console.log('Launching browser (Headless: true/New)...');
    browser = await puppeteer.launch({
        headless: true, // Puppeteer v22: true = New Headless mode
        userDataDir: USER_DATA_DIR,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
        ],
        dumpio: true, // Log browser errors to stdout
        timeout: 30000 // 30s launch timeout
    });

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
            await page.waitForSelector('.chat-list, .login_head_bg, canvas', { timeout: 15000 });
        } catch (e) {
            console.log('Element wait timed out, proceeding to screenshot anyway');
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
