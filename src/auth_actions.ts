import { Page } from 'puppeteer';

export async function loginWithPhone(page: Page, phoneNumber: string) {
    console.log(`[Auth] Starting login with phone: ${phoneNumber}`);

    // Navigate to K version specifically as it's more stable for automation
    await page.goto('https://web.telegram.org/k/', { waitUntil: 'networkidle0' });

    // Check if we are potentially already logged in
    const isLogin = await page.$('.login_head_submit_btn, .login_header, .input-field-input');
    if (!isLogin) {
        // Might be logged in, or loading.
        const chatList = await page.$('.chat-list');
        if (chatList) throw new Error('Already logged in!');
    }

    // 1. Click "Log in by phone Number" if visible
    try {
        const phoneLoginBtnHandle = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => b.textContent && b.textContent.includes('Phone Number'));
        });

        const phoneLoginBtn = phoneLoginBtnHandle.asElement();
        if (phoneLoginBtn) {
            await phoneLoginBtn.click();
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        console.log('[Auth] "Phone Number" button not found or already in phone mode.');
    }

    // 2. Input Phone Number
    // Selector for phone input in Web K
    const inputSelector = 'input[name="phone_number"], .input-field-input';
    await page.waitForSelector(inputSelector, { timeout: 5000 });

    // Clear input first
    await page.click(inputSelector);
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');

    await page.type(inputSelector, phoneNumber, { delay: 100 });
    await new Promise(r => setTimeout(r, 500));

    // 3. Click Next
    const nextBtn = await page.$('.btn-primary, button[type="submit"]');
    if (nextBtn) {
        await nextBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    console.log('[Auth] Phone number submitted. Waiting for code prompt...');

    // 4. Wait for Code Input
    // Usually triggers a new slide/form
    await page.waitForSelector('input[name="phone_code"], input[type="tel"]', { timeout: 10000 });
    console.log('[Auth] Ready for code input.');
}

export async function submitVerificationCode(page: Page, code: string) {
    console.log(`[Auth] Submitting verification code: ${code}`);

    const codeInputSelector = 'input[name="phone_code"], input[type="tel"]';
    await page.waitForSelector(codeInputSelector, { timeout: 5000 });

    await page.type(codeInputSelector, code, { delay: 150 });

    // Web K usually auto-submits once length is reached, but we can try pressing Enter
    await new Promise(r => setTimeout(r, 1000));

    // Check for password prompt (2FA)
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
        throw new Error('2FA Password required. This bot does not support 2FA yet.');
    }

    // Wait for login success (chat list appearance)
    try {
        await page.waitForSelector('.chat-list', { timeout: 15000 });
        console.log('[Auth] Login successful!');
        return true;
    } catch (e) {
        console.log('[Auth] Chat list did not appear. Code might be wrong.');
        throw new Error('Login failed or code invalid.');
    }
}
