import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { assessImageQuality } from '@/domain/kyc/documents';
import { blurScore } from '@/server/adapters/images/blur-score';
import { DATA_DIR } from '../../helpers/data-pack';

const specimen = (name: string) => path.join(DATA_DIR, 'kyc_documents', name);

async function textLikeImage(): Promise<Buffer> {
  const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    ${Array.from({ length: 12 }, (_, row) => `<rect x="20" y="${20 + row * 30}" width="${300 + row * 30}" height="10" fill="black"/>`).join('')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('blurScore', () => {
  it('scores a flat image near zero', async () => {
    const flat = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#777777' } })
      .png()
      .toBuffer();
    expect(await blurScore(flat)).toBeLessThan(1);
  });

  it('scores sharp edges far above the domain threshold', async () => {
    const score = await blurScore(await textLikeImage());
    expect(assessImageQuality(score)).toBe('OK');
  });

  it('falls well below the threshold once the same image is blurred', async () => {
    const blurred = await sharp(await textLikeImage()).blur(8).png().toBuffer();
    expect(assessImageQuality(await blurScore(blurred))).toBe('BLURRED');
  });

  it('is not skewed by an alpha channel', async () => {
    const opaque = await textLikeImage();
    const withAlpha = await sharp(opaque).ensureAlpha().png().toBuffer();
    expect(await blurScore(withAlpha)).toBeCloseTo(await blurScore(opaque), 0);
  });

  describe.skipIf(!existsSync(specimen('K04_gst_certificate.png')))('on the real specimens', () => {
    it("scores K04's blurred GST certificate near 1", async () => {
      const score = await blurScore(readFileSync(specimen('K04_gst_certificate.png')));
      expect(score).toBeLessThan(5);
      expect(assessImageQuality(score)).toBe('BLURRED');
    });

    it.each(['K03_gst_certificate.png', 'K02_gst_certificate.png', 'K11_address_proof.png', 'K01_signatory_id.png'])(
      'scores %s at 433 or more',
      async (name) => {
        const score = await blurScore(readFileSync(specimen(name)));
        expect(score).toBeGreaterThanOrEqual(433);
        expect(assessImageQuality(score)).toBe('OK');
      },
    );
  });
});
