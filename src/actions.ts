import { Page } from 'puppeteer';
import prisma from './db';

// --- DB Helpers ---

async function ensureUserAndDialogue(username: string, name: string) {
    // 1. Find or Create User
    let user = await prisma.user.findFirst({
        where: { telegramId: username }
    });

    if (!user) {
        user = await prisma.user.create({
            data: {
                telegramId: username,
                username: username,
                firstName: name,
                status: 'LEAD'
            }
        });
        console.log(`[DB] Created new user: ${username}`);
    } else {
        if (name && name !== user.firstName) {
            await prisma.user.update({
                where: { id: user.id },
                data: { firstName: name }
            });
        }
    }

    // 2. Find or Create Active Dialogue
    let dialogue = await prisma.dialogue.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' }
    });

    if (!dialogue) {
        dialogue = await prisma.dialogue.create({
            data: {
                userId: user.id,
                status: 'ACTIVE'
            }
        });
        console.log(`[DB] Created new dialogue for user: ${username}`);
    }

    return { user, dialogue };
}

async function saveMessageToDb(dialogueId: number, sender: 'SIMULATOR' | 'USER', text: string) {
    try {
        await prisma.message.create({
            data: {
                dialogueId,
                sender,
                text
            }
        });
        console.log(`[DB] Saved ${sender} message: "${text.substring(0, 20)}..."`);
    } catch (e) {
        console.error(`[DB] Failed to save message: ${e}`);
    }
}

async function scrapeHistory(page: Page, dialogueId: number) {
    console.log(`[Scraper] Starting history scrape for dialogue ${dialogueId}...`);
    try {
        // Web K selectors
        // Messages are usually in .bubble
        const messages = await page.evaluate(() => {
            const bubbles = Array.from(document.querySelectorAll('.bubble'));
            return bubbles.map(b => {
                const isOut = b.classList.contains('is-out');
                const textEl = b.querySelector('.message'); // or .text-content
                const text = textEl ? textEl.textContent?.trim() : '';

                // Try to find time
                const timeEl = b.querySelector('.time');
                const time = timeEl ? timeEl.textContent?.trim() : '';

                return {
                    sender: isOut ? 'SIMULATOR' : 'USER',
                    text: text || '',
                    time
                };
            }).filter(m => m.text && m.text.length > 0);
        });

        console.log(`[Scraper] Found ${messages.length} messages.`);

        // Save to DB (naive implementation: save if not exists exact match)
        // In reality, we should fetch existing messages and compare, or use a better unique constraint.
        // For now, let's just save valid messages and ignore duplicates based on simple logic if needed, 
        // OR just simple insert for the MVP (assuming we scrape once or accept dupes).
        // Let's try to avoid exact duplicates in the last 10 messages.

        const existing = await prisma.message.findMany({
            where: { dialogueId },
            orderBy: { id: 'desc' },
            take: 50
        });

        let savedCount = 0;
        for (const msg of messages) {
            // Check if this message was already saved (simple check)
            const isDuplicate = existing.some(e =>
                e.text === msg.text &&
                e.sender === msg.sender
                // && time check if we parsed date correctly, but we only have "HH:MM" usually
            );

            if (!isDuplicate) {
                await prisma.message.create({
                    data: {
                        dialogueId,
                        sender: msg.sender as 'SIMULATOR' | 'USER',
                        text: msg.text
                    }
                });
                savedCount++;
            }
        }
        console.log(`[Scraper] Saved ${savedCount} new messages.`);

    } catch (e) {
        console.error(`[Scraper] Failed: ${e}`);
    }
}


// --- Main Actions ---

// --- Shared Navigation Logic ---

export async function openChat(page: Page, username: string): Promise<string> {
    console.log(`[Nav] Opening chat with @${username}...`);

    // 1. Try Direct Navigation
    const targetUrl = username.includes('http') ? username : `https://web.telegram.org/k/#@${username}`;
    if (page.url() !== targetUrl) {
        await page.goto(targetUrl, { waitUntil: 'networkidle0' });
    }

    const chatSelector = '.chat-input-control';
    const searchInputSelector = '.input-search > input';
    let chatFound = false;

    // Check if we are already in the chat (if accessed via URL directly)
    try {
        await page.waitForSelector(chatSelector, { timeout: 5000 });
        chatFound = true;
    } catch (e) {
        console.log(`[Nav] Direct navigation didn't open chat immediately. Trying search...`);
        try {
            await page.waitForSelector(searchInputSelector, { timeout: 4000 });
            await page.click(searchInputSelector);
            // Clear search
            await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta'); await page.keyboard.press('Backspace');

            console.log(`[Nav] Searching for ${username}...`);
            await page.type(searchInputSelector, username, { delay: 100 });
            await new Promise(r => setTimeout(r, 3000));

            // Search result click logic
            let clicked = false;
            try {
                // Try to find exact match first
                const handle = await page.evaluateHandle((u) => {
                    const text = u.replace('@', '');
                    const xpath = `//*[contains(@class, 'peer-title') and (text()='${text}' or text()='@${text}')]`;
                    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    return result.singleNodeValue;
                }, username);

                let element = handle.asElement();

                // Fallback: search result item
                if (!element) {
                    element = await page.$('.search-result'); // click first result
                }

                if (element) {
                    await element.click();
                    clicked = true;
                }
            } catch (xErr) { console.log("Click failed:", xErr); }

            if (!clicked) {
                // Fallback: Arrow down + Enter
                await page.keyboard.press('ArrowDown');
                await new Promise(r => setTimeout(r, 500));
                await page.keyboard.press('Enter');
            }

            await page.waitForSelector(chatSelector, { timeout: 8000 });
            chatFound = true;
        } catch (searchErr) {
            console.error(`[Nav] Search failed: ${searchErr}`);
            throw new Error(`Chat with @${username} not found.`);
        }
    }

    if (!chatFound) throw new Error(`Failed to open chat with @${username}`);

    await new Promise(r => setTimeout(r, 1000));
    return await getChatName(page);
}


// --- Main Actions ---

export async function sendMessageToUser(page: Page, username: string, message: string) {
    const name = await openChat(page, username);

    // DB Init
    const { dialogue } = await ensureUserAndDialogue(username, name);

    // Scrape before sending (optional but good for context)
    // await scrapeHistory(page, dialogue.id); 

    // Send
    const inputSelector = '.input-message-input';
    await page.waitForSelector(inputSelector);
    await page.click(inputSelector);

    console.log(`[Msg] Typing message...`);
    for (const char of message) { await page.type(inputSelector, char, { delay: Math.random() * 50 + 20 }); }
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Enter');

    console.log(`[Msg] Sent to @${username}`);

    // Save sent message
    await saveMessageToDb(dialogue.id, 'SIMULATOR', message);
}

export async function checkLogin(page: Page): Promise<boolean> {
    try {
        await page.waitForSelector('.chat-list, .sidebar-header', { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

export async function getChatName(page: Page): Promise<string> {
    try {
        const selectors = ['.chat-header .peer-title', '.chat-info .person-name', '.top .peer-title', '.chat-title', '.user-title'];
        for (const selector of selectors) {
            const el = await page.$(selector);
            if (el) {
                const name = await page.evaluate(el => el.textContent, el);
                if (name && name.trim().length > 0) return name.trim();
            }
        }
        return "Unknown";
    } catch (e) {
        console.error("Failed to get chat name:", e);
        return "Unknown";
    }
}

export async function startDialogue(page: Page, username: string, referrer: string, topic: string) {
    console.log(`Starting dialogue with @${username}...`);

    // Use shared openChat
    const name = await openChat(page, username);
    console.log(`Detected name: ${name}`);

    const displayName = (name && name !== "Unknown" && name !== "Saved Messages") ? name : username;

    // 3. DB Sync & History Scrape
    const { user, dialogue } = await ensureUserAndDialogue(username, displayName);
    await scrapeHistory(page, dialogue.id);

    // 4. Construct Message
    const message = `${name} - Здравствуйте, мне ваш контакт передал ${referrer}, сказал вы занимаетесь ${topic}`;
    console.log(`Generated message: "${message}"`);

    // 5. Send Message
    const inputSelector = '.input-message-input';
    await page.click(inputSelector);
    for (const char of message) { await page.type(inputSelector, char, { delay: Math.random() * 100 + 40 }); }
    await new Promise(r => setTimeout(r, 800));
    await page.keyboard.press('Enter');

    console.log(`Dialogue started with @${username}`);

    // LOG SENT MESSAGE
    await saveMessageToDb(dialogue.id, 'SIMULATOR', message);

    return { success: true, nameUsed: name, messageSent: message };
}
