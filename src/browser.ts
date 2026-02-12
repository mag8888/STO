import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import path from 'path';

puppeteer.use(StealthPlugin());

let browser: Browser | null = null;
let page: Page | null = null;

const USER_DATA_DIR = path.join(process.cwd(), 'session_data');

export async function initBrowser() {
    if (browser) return { browser, page };

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
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Browser launched. Loading Telegram Web...');
    try {
        // Use domcontentloaded for faster initial load, then wait for content
        await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('Page loaded (domcontentloaded). Waiting for QR code or chat list...');

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
