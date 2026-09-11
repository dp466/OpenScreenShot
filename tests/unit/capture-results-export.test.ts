import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureBundle } from '../../src/shared/capture-bundles';
import { imageBlob, pdfPages, pdfSliceHeight } from '../../src/capture-results/export';

vi.mock('../../src/shared/capture-bundles', () => ({
  readCapturePart: vi.fn(async () => 'data:image/png;base64,AAAA'),
}));

afterEach(() => vi.unstubAllGlobals());

describe('long capture PDF export', () => {
  it('bounds individual PDF canvas dimensions even for maximum capture width', () => {
    for (const width of [1, 1920, 3840, 10000, 32000]) {
      const height = pdfSliceHeight(width);
      expect(height).toBeLessThanOrEqual(16000);
      expect(width * height).toBeLessThanOrEqual(16_000_000);
      expect((height * 194) / width).toBeLessThanOrEqual(281);
    }
  });

  it('accepts local PNG bytes only and never fetches remote content', () => {
    expect(imageBlob('data:image/png;base64,AAAA').size).toBe(3);
    expect(() => imageBlob('https://example.test/private.png')).toThrow('Invalid local');
  });

  it('fills PDF pages across section boundaries with no missing or duplicate rows', async () => {
    const bundle: CaptureBundle = {
      id: 'test',
      title: 'private',
      url: '',
      output: 'pdf',
      width: 4,
      height: 8,
      parts: [
        { index: 0, width: 4, height: 3, y: 0 },
        { index: 1, width: 4, height: 5, y: 3 },
      ],
      warnings: [],
      incomplete: false,
      createdAt: 0,
    };
    const draws: number[][] = [];
    let liveBitmaps = 0;
    let maxLiveBitmaps = 0;
    let created = 0;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        liveBitmaps++;
        maxLiveBitmaps = Math.max(maxLiveBitmaps, liveBitmaps);
        const index = created++;
        return {
          width: 4,
          height: index === 0 ? 3 : 5,
          close: () => {
            liveBitmaps--;
          },
        };
      }),
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillRect: () => {},
          drawImage: (_bitmap: unknown, ...args: number[]) => draws.push(args),
        }),
      }),
    });
    const progress = vi.fn();
    const sizes: number[][] = [];
    const labels: (string | undefined)[] = [];
    for await (const page of pdfPages(bundle, progress, 'Équipe Québec')) {
      sizes.push([page.image.canvas.width, page.image.canvas.height]);
      labels.push(page.watermark);
    }
    expect(sizes).toEqual([
      [4, 5],
      [4, 3],
    ]);
    expect(labels).toEqual(['Équipe Québec', 'Équipe Québec']);
    expect(draws).toEqual([
      [0, 0, 4, 3, 0, 0, 4, 3],
      [0, 0, 4, 2, 0, 3, 4, 2],
      [0, 2, 4, 3, 0, 0, 4, 3],
    ]);
    expect(maxLiveBitmaps).toBe(1);
    expect(liveBitmaps).toBe(0);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
