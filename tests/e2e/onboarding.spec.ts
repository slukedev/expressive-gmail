import type { Page } from '@playwright/test';
import { DEFAULT_SEED, expect, test } from './fixtures';

test.use({ seed: { ...DEFAULT_SEED, onboarded: false } });

const welcome = (page: Page) => page.locator('.onboarding');
const heading = (page: Page) => welcome(page).getByRole('heading', { level: 2 });
const dots = (page: Page) => welcome(page).locator('.onboarding__dot');

async function geminiSwitchInSettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'See all settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Gemini' }).click();
  return settings.getByRole('switch', { name: 'Gemini', exact: true });
}

test.describe('First-run setup', () => {
  test('offers Gemini on, as Gmail has it; turning it off there is the same setting as in Settings', async ({ mail, page }) => {
    await mail.open('inbox', 'onboarding');
    await expect(heading(page)).toHaveText('This is still your Gmail');
    await expect(dots(page)).toHaveCount(5);
    for (let i = 0; i < 3; i++) await welcome(page).getByRole('button', { name: 'Next' }).click();
    await expect(heading(page)).toHaveText('Gemini in Gmail');
    const use = welcome(page).getByRole('switch', { name: 'Use Gemini' });
    await expect(use).toBeChecked();
    // The label turns it too.
    await welcome(page).getByText('Use Gemini').click();
    await expect(use).not.toBeChecked();
    await welcome(page).getByRole('button', { name: 'Next' }).click();
    await expect(heading(page)).toHaveText('Classic Gmail is one click away');
    await welcome(page).getByRole('button', { name: 'Get started' }).click();
    await expect(welcome(page)).toBeHidden();

    await expect(page.getByRole('banner').getByRole('button', { name: 'Ask Gemini' })).toHaveCount(0);
    const master = await geminiSwitchInSettings(page);
    await expect(master).not.toBeChecked();
    await expect(master).toBeEnabled();
    await master.click();
    await expect(master).toBeChecked();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close settings' }).last().click();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Ask Gemini' })).toHaveCount(1);
  });

  test('skips Gemini for an account Gmail shows no Gemini for, and Settings shows it off and fixed', async ({ mail, page }) => {
    await mail.open('inbox', 'onboarding&gemini=plan');
    await expect(heading(page)).toHaveText('This is still your Gmail');
    await expect(dots(page)).toHaveCount(4);
    for (let i = 0; i < 3; i++) await welcome(page).getByRole('button', { name: 'Next' }).click();
    await expect(heading(page)).toHaveText('Classic Gmail is one click away');
    await welcome(page).getByRole('button', { name: 'Get started' }).click();

    const master = await geminiSwitchInSettings(page);
    await expect(master).not.toBeChecked();
    await expect(master).toBeDisabled();
  });
});
