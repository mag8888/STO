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

    if (browser) return { browser, page };

    // Fix for "Profile in use" error in Docker/Railway
    const lockFile = path.join(USER_DATA_DIR, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        console.log('Removing stale Chromium lock file...');
        try {
            fs.unlinkSync(lockFile);
        } catch (e) {
            console.error('Failed to remove lock file:', e);
        }
    }

    console.log('Launching browser...');
    browser = await puppeteer.launch({
        headless: true, // Run in headless mode to avoid X11 errors
        userDataDir: USER_DATA_DIR,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // CRITICAL for Docker
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"'
        ]
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

    console.log('Loading Telegram Web...');
    try {
        // Use user agent rotation or fixed one
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Go to Telegram Web
        await page.goto('https://web.telegram.org/k/', {
            waitUntil: 'networkidle0', // Wait until network is quiet (better for SPAs)
            timeout: 60000
        });

        console.log('Page loaded (networkidle0). Waiting for selector...');

        // Try to wait for key elements (QR canvas or chat list)
        try {
            await page.waitForSelector('canvas, .chat-list', { timeout: 10000 });
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
        await browser.close();
        browser = null;
        page = null;
    }
}
