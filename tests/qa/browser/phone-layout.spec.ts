import { expect, test, type Page } from '@playwright/test';
import { grant, nextPhone, observe } from './qa-helpers';

/** Measures what a thumb can see: Playwright's own clicks scroll for it, and an owner's don't. */
const SIZES: Array<[string, number, number, 'en' | 'hi']> = [
  ['360 English', 360, 780, 'en'],
  ['360 Hindi', 360, 780, 'hi'],
  ['320 English', 320, 640, 'en'],
  ['320 Hindi', 320, 640, 'hi'],
];

const WORDS = {
  en: { agree: 'I agree to this use of my business details', ai: /Google Gemini reading what I type/, start: 'Start with the advisor', shop: 'Shop or small service', size: '5 to 9', gst: 'Yes, active', yes: 'Yes', none: 'None of these', hi: false },
  hi: { agree: 'मैं अपने व्यवसाय की जानकारी के इस उपयोग के लिए सहमत हूँ', ai: /Google Gemini चैट में मेरा लिखा पढ़े/, start: 'सलाहकार से शुरू करें', shop: 'दुकान या छोटी सेवा', size: '5 से 9', gst: 'हाँ, सक्रिय है', yes: 'हाँ', none: 'इनमें से कुछ नहीं', hi: true },
};

async function toNeeds(page: Page, locale: 'en' | 'hi'): Promise<void> {
  const words = WORDS[locale];
  await page.goto('/');
  if (words.hi) await page.getByRole('button', { name: 'हिन्दी' }).click();
  await page.getByRole('checkbox', { name: words.agree }).check();
  await page.getByRole('checkbox', { name: words.ai }).check();
  await page.getByRole('button', { name: words.start }).click();
  await page.getByRole('button', { name: words.shop, exact: true }).click();
  await expect(page.getByRole('button', { name: words.shop, exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: words.size, exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: words.gst, exact: true }).click();
  await page.getByRole('button', { name: words.yes, exact: true }).click();
  await page.getByRole('button', { name: words.none, exact: true }).waitFor();
}

for (const [name, width, height, locale] of SIZES) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } });

    test('the needs question: chips readable, question visible, nothing out of reach', async ({ page }) => {
      await toNeeds(page, locale);
      await page.waitForTimeout(400);
      const seen = await page.evaluate(() => {
        const bar = document.querySelector('.sticky') as HTMLElement;
        const bubbles = [...document.querySelectorAll('main ul li')];
        const question = bubbles[bubbles.length - 1] as HTMLElement;
        const chips = [...document.querySelectorAll('main [role=group] button')] as HTMLElement[];
        const barRect = bar.getBoundingClientRect();
        const questionRect = question.getBoundingClientRect();
        return {
          barHeight: Math.round(barRect.height),
          viewport: innerHeight,
          atRest: { scrollY: Math.round(scrollY), questionTop: Math.round(questionRect.top), questionBottom: Math.round(questionRect.bottom), barTop: Math.round(barRect.top) },
          chips: chips.length,
        };
      });
      // Can the owner, by scrolling alone, ever see the question and the first chip?
      const reachable = await page.evaluate(() => {
        const bar = document.querySelector('.sticky') as HTMLElement;
        const first = document.querySelector('main [role=group] button') as HTMLElement;
        const bubbles = [...document.querySelectorAll('main ul li')];
        const question = bubbles[bubbles.length - 1] as HTMLElement;
        const max = document.documentElement.scrollHeight - innerHeight;
        let chipSeen = false;
        let questionSeen = false;
        for (let y = 0; y <= max; y += 20) {
          scrollTo(0, y);
          const chip = first.getBoundingClientRect();
          if (chip.top >= 0 && chip.bottom <= innerHeight) chipSeen = true;
          const q = question.getBoundingClientRect();
          const top = bar.getBoundingClientRect().top;
          if (q.top >= 0 && q.bottom <= Math.min(top, innerHeight)) questionSeen = true;
        }
        return { chipSeen, questionSeen, max };
      });
      const none = page.getByRole('button', { name: WORDS[locale].none, exact: true });
      const paint = await none.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, className: element.className };
      });
      await page.screenshot({ path: `test-results/qa/needs-${width}-${locale}.png` });
      observe(test.info(), { name, seen, reachable, paint });
      expect(paint.color, 'the "none of these" chip has readable text').not.toBe(paint.background);
      expect(seen.barHeight, 'the sticky bar leaves room for the chat').toBeLessThan(height * 0.7);
      expect(reachable.questionSeen, 'the question can be seen above the sticky bar').toBe(true);
    });
  });
}

test('Accept shows the phone step where the owner is looking', async ({ page }) => {
  await page.goto('/');
  await page.request.post('/api/v1/sessions');
  await grant(page.request, 'advisor_profile');
  await page.request.post('/api/v1/quotes', {
    data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P01', quantity: 1 }] },
  });
  await page.goto('/quote');
  await page.getByRole('button', { name: 'Accept and verify my business' }).click();
  await page.getByLabel('Mobile number').waitFor();
  await page.waitForTimeout(600);
  const seen = await page.getByLabel('Mobile number').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bar = document.querySelector('.sticky')?.getBoundingClientRect();
    return { scrollY: Math.round(scrollY), fieldTop: Math.round(rect.top), barTop: Math.round(bar?.top ?? innerHeight) };
  });
  observe(test.info(), seen);
  expect(seen.fieldTop, 'the phone field is above the sticky bar without the owner hunting for it').toBeLessThan(seen.barTop);
  const number = nextPhone();
  await page.getByLabel('Mobile number').fill(number);
});
