import { Page } from 'puppeteer';
import path from 'path';

async function screenshot(page: Page, step: string) {
    try {
        console.log(`[Auth] Screenshot: ${step}`);
        await page.screenshot({ path: path.join(process.cwd(), 'login_status.png') });
    } catch (e) {
        console.error(`[Auth] Failed to take screenshot for ${step}:`, e);
    }
}

export async function loginWithPhone(page: Page, phoneNumber: string) {
    console.log(`[Auth] Starting login with phone: ${phoneNumber}`);
    await screenshot(page, 'start_phone_login');

    // Navigate to K version specifically as it's more stable for automation
    if (!page.url().includes('web.telegram.org/k/')) {
        await page.goto('https://web.telegram.org/k/', { waitUntil: 'networkidle0' });
        await screenshot(page, 'navigated_to_k');
    }

    // Check if we are potentially already logged in
    const isLogin = await page.$('.login_head_submit_btn, .login_header, .input-field-input');
    if (!isLogin) {
        // Might be logged in, or loading.
        const chatList = await page.$('.chat-list');
        if (chatList) throw new Error('Already logged in!');
    }

    // 1. Click "Log in by phone Number" if visible
    console.log('[Auth] Looking for "Phone Number" button...');
    try {
        // Log all buttons for debugging
        const buttonInfo = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.map(b => ({ text: b.textContent || '', className: b.className }));
        });
        console.log('[Auth] Visible buttons:', JSON.stringify(buttonInfo));

        // Strategy 1: Text match
        let clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const phoneBtn = buttons.find(b => {
                const text = (b.textContent || '').toLowerCase();
                return text.includes('phone') || text.includes('number') || text.includes('телефон');
            });
            if (phoneBtn) {
                phoneBtn.click();
                return true;
            }
            return false;
        });

        if (clicked) {
            console.log('[Auth] Clicked "Phone Number" button via text match');
            await new Promise(r => setTimeout(r, 1500)); // Wait for transition
            await screenshot(page, 'clicked_phone_button_text');
        } else {
            console.log('[Auth] Text match failed. Trying CSS strategy...');
            // Strategy 2: CSS class (often .btn-primary.btn-secondary or similar for the secondary action)
            clicked = await page.evaluate(() => {
                const btn = document.querySelector('button.btn-secondary, button.btn-transparent');
                if (btn) {
                    (btn as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                console.log('[Auth] Clicked button via CSS strategy');
                await new Promise(r => setTimeout(r, 1500));
                await screenshot(page, 'clicked_phone_button_css');
            } else {
                console.log('[Auth] No suitable button found. Checking if input is already visible...');
            }
        }
    } catch (e) {
        console.log('[Auth] Error trying to click phone button:', e);
    }

    // 2. Input Phone Number
    // Selector for phone input in Web K
    const inputSelector = 'input[name="phone_number"], .input-field-input, input[type="tel"]';
    try {
        await page.waitForSelector(inputSelector, { timeout: 5000 });
    } catch (e) {
        await screenshot(page, 'input_not_found');
        throw new Error('Phone input field not found. See screenshot.');
    }

    // Clear input first
    await page.evaluate((selector) => {
        const el = document.querySelector(selector) as HTMLInputElement;
        if (el) {
            el.value = '';
            el.focus();
        }
    }, inputSelector);

    // Fallback clear
    await page.click(inputSelector);
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.keyboard.press('Backspace');

    console.log(`[Auth] Typing phone number: ${phoneNumber}`);
    await page.type(inputSelector, phoneNumber, { delay: 150 });

    // Check if entered correctly
    const val = await page.evaluate((selector) => {
        return (document.querySelector(selector) as HTMLInputElement).value;
    }, inputSelector);
    console.log(`[Auth] Input value after typing: ${val}`);

    await new Promise(r => setTimeout(r, 1000));
    await screenshot(page, 'phone_entered');

    // 3. Click Next
    const nextBtn = await page.$('.btn-primary, button[type="submit"], .login_head_submit_btn');
    if (nextBtn) {
        await nextBtn.click();
        console.log('[Auth] Clicked Next button');
    } else {
        await page.keyboard.press('Enter');
        console.log('[Auth] Pressed Enter');
    }

    console.log('[Auth] Phone number submitted. Waiting for code prompt...');
    await new Promise(r => setTimeout(r, 2000));
    await screenshot(page, 'after_submit');

    // 4. Check for errors (e.g. invalid number)
    const error = await page.$('.error');
    if (error) {
        const errorText = await page.evaluate(el => el.textContent, error);
        throw new Error(`Telegram Error: ${errorText}`);
    }

    // 5. Wait for Code Input
    // Usually triggers a new slide/form
    try {
        await page.waitForSelector('input[name="phone_code"], input[type="tel"]', { timeout: 10000 });
        console.log('[Auth] Ready for code input.');
        await screenshot(page, 'waiting_for_code');
    } catch (e) {
        await screenshot(page, 'timeout_waiting_for_code');
        throw new Error('Timeout waiting for code input. Check screenshot.');
    }
}

export async function submitVerificationCode(page: Page, code: string) {
    console.log(`[Auth] Submitting verification code: ${code}`);

    const codeInputSelector = 'input[name="phone_code"], input[type="tel"]';
    await page.waitForSelector(codeInputSelector, { timeout: 5000 });

    await page.type(codeInputSelector, code, { delay: 150 });

    // Web K usually auto-submits once length is reached, but we can try pressing Enter
    await new Promise(r => setTimeout(r, 1000));
    await screenshot(page, 'code_entered');

    // Check for password prompt (2FA)
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
        await screenshot(page, '2fa_required');
        throw new Error('2FA Password required. This bot does not support 2FA yet.');
    }

    // Wait for login success (chat list appearance)
    try {
        await page.waitForSelector('.chat-list', { timeout: 15000 });
        console.log('[Auth] Login successful!');
        await screenshot(page, 'login_success');
        return true;
    } catch (e) {
        // If chat list didn't appear, check if we are on password screen
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
            console.log('[Auth] 2FA Password screen detected.');
            await screenshot(page, '2fa_required');
            return '2FA_REQUIRED';
        }

        console.log('[Auth] Chat list did not appear. Code might be wrong.');
        await screenshot(page, 'login_failed');
        throw new Error('Login failed or code invalid.');
    }
}

export async function submitPassword(page: Page, password: string) {
    console.log(`[Auth] Submitting 2FA password...`);
    await screenshot(page, 'start_password_submit');

    const passwordInputSelector = 'input[type="password"]';
    try {
        await page.waitForSelector(passwordInputSelector, { timeout: 5000 });
    } catch (e) {
        throw new Error('Password input not found. Are you on the 2FA screen?');
    }

    await page.type(passwordInputSelector, password, { delay: 100 });
    await new Promise(r => setTimeout(r, 500));
    await screenshot(page, 'password_entered');

    // Click Next/Submit
    const nextBtn = await page.$('.btn-primary, button[type="submit"], .login_head_submit_btn');
    if (nextBtn) {
        await nextBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    console.log('[Auth] Password submitted. Waiting for login...');
    await new Promise(r => setTimeout(r, 1000));

    // Wait for login success
    try {
        await page.waitForSelector('.chat-list', { timeout: 15000 });
        console.log('[Auth] Login successful!');
        await screenshot(page, 'login_success_2fa');
        return true;
    } catch (e) {
        const error = await page.$('.error');
        if (error) {
            const errorText = await page.evaluate(el => el.textContent, error);
            throw new Error(`Password Error: ${errorText}`);
        }
        await screenshot(page, 'login_failed_2fa');
        throw new Error('Login failed after password.');
    }
}

export async function injectSession(page: Page, sessionData: any) {
    console.log('[Auth] Injecting session data...');
    await screenshot(page, 'start_injection');

    // Ensure we are on the target domain
    if (!page.url().includes('web.telegram.org')) {
        await page.goto('https://web.telegram.org/k/', { waitUntil: 'networkidle0' });
    }

    try {
        await page.evaluate((data) => {
            localStorage.clear();
            for (const key in data) {
                localStorage.setItem(key, data[key]);
            }
        }, sessionData);

        console.log('[Auth] LocalStorage injected. Reloading...');
        await page.reload({ waitUntil: 'networkidle0' });
        await new Promise(r => setTimeout(r, 2000));

        await screenshot(page, 'after_injection');

        // specific check for K version
        const chatList = await page.$('.chat-list');
        if (chatList) {
            console.log('[Auth] Injection successful! Logged in.');
            return true;
        } else {
            console.warn('[Auth] Chat list not found after injection. Checking for login screen...');
            const loginBtn = await page.$('.login_head_submit_btn');
            if (loginBtn) throw new Error('Injection failed: Still on login screen (keys might be invalid).');
            return true; // Assume success if no login screen, maybe loading
        }

    } catch (e) {
        console.error('[Auth] Injection failed:', e);
        throw e;
    }
}
