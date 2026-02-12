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
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certifcate-errors',
            '--ignore-certifcate-errors-spki-list',
            '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"'
        ]
    });

    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Set viewport to a common resolution
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Browser launched. Loading Telegram Web...');
    await page.goto('https://web.telegram.org/k/', { waitUntil: 'networkidle2', timeout: 60000 });

    // Take a screenshot to check login status/QR code
    console.log('Page loaded. Taking screenshot...');
    await page.screenshot({ path: 'login_status.png' });
    console.log('Screenshot saved to login_status.png. Please check this image to scan QR code if needed.');

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
