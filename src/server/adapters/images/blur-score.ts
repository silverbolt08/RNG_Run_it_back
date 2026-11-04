import sharp from 'sharp';

const LAPLACIAN_KERNEL = [0, 1, 0, 1, -4, 1, 0, 1, 0];
// The kernel can give negative values, so this offset stops them being clipped to 0.
const LAPLACIAN_OFFSET = 128;

/**
 * Variance of the Laplacian: edges score high, and blur flattens them. The spike measured K04's
 * GST certificate at 1 and every other specimen at 433 or more, which the domain's
 * `assessImageQuality` turns into a verdict.
 */
export async function blurScore(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: LAPLACIAN_KERNEL, offset: LAPLACIAN_OFFSET })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return variance(data, info.channels);
}

function variance(pixels: Buffer, channels: number): number {
  const count = Math.floor(pixels.length / channels);
  if (count === 0) return 0;

  let sum = 0;
  let sumOfSquares = 0;
  for (let index = 0; index < pixels.length; index += channels) {
    const value = pixels.readUInt8(index);
    sum += value;
    sumOfSquares += value * value;
  }
  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
}
