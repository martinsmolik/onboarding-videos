import type { Page } from 'playwright';

export interface LoginOpts {
  url: string;
  user: string;
  pass: string;
  log?: (line: string) => void;
}

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url);

/** True when the recorder should attempt a form login before the first step. */
export function shouldLogin(startUrl: string): boolean {
  return !!(process.env.SLONEEK_DEMO_USER && process.env.SLONEEK_DEMO_PASS) && !isLocal(startUrl);
}

/**
 * Best-effort login hook. Only runs when SLONEEK_DEMO_USER/PASS are set and
 * the start URL is not localhost, so the local demo is never affected.
 *
 * TODO(sloneek): replace the generic selectors below with Sloneek's real login
 * form selectors (app.sloneek.com). Check for: SSO redirect, "remember me",
 * 2FA, cookie banner. Once verified, prefer saving a storageState file
 * (recipe.start.storage_state) so recordings skip the login screen entirely.
 */
export async function login(page: Page, opts: LoginOpts): Promise<boolean> {
  const log = opts.log ?? (() => {});
  try {
    const loginUrl = process.env.SLONEEK_DEMO_URL || opts.url;
    await page.goto(loginUrl, { waitUntil: 'load' });

    // Generic best guess – MUST be adjusted for Sloneek (see TODO above).
    const email = page.locator('input[type=email], input[name=email], input[name=username]').first();
    const pass = page.locator('input[type=password]').first();
    const submit = page.locator('button[type=submit]').first();

    if (!(await email.isVisible({ timeout: 5000 }).catch(() => false))) {
      log('login: no login form detected – assuming already authenticated');
      return false;
    }
    await email.fill(opts.user);
    await pass.fill(opts.pass);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
      submit.click()
    ]);
    log('login: submitted credentials');
    return true;
  } catch (e) {
    log(`login: failed (${(e as Error).message}) – continuing without login`);
    return false;
  }
}
