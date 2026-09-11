import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPdf, type PdfOptions, type PdfExportProgress } from '../../src/editor/pdf';
import { buildPdf, type PdfPage } from '../../src/editor/pdf-writer';

vi.mock('../../src/editor/pdf-writer', () => ({
  buildPdf: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
}));

function canvas(width: number, height: number): HTMLCanvasElement {
  return {
    width,
    height,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
  } as unknown as HTMLCanvasElement;
}

const defaults: PdfOptions = {
  pageSize: 'a4',
  orientation: 'portrait',
  multiPage: false,
  marginMm: 10,
};

const watermark = 'Étude d’été – façade.pdf';
const filename = `${watermark}.pdf`;
const download = vi.fn(async () => 1);

async function generate(
  source: HTMLCanvasElement,
  opts: Partial<PdfOptions>,
  mark?: string,
  progress?: (value: PdfExportProgress) => void,
): Promise<PdfPage[]> {
  const result = exportPdf(source, { ...defaults, ...opts }, filename, progress, mark);
  await vi.runAllTimersAsync();
  await result;
  const pages = vi.mocked(buildPdf).mock.lastCall?.[0];
  expect(pages).toBeDefined();
  return pages!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe('canvas');
      return canvas(0, 0);
    }),
  });
  vi.stubGlobal('chrome', { downloads: { download } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:watermarked-pdf');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('editor PDF page layouts with a filename watermark', () => {
  it('preserves the image-sized page and forwards the exact chosen name', async () => {
    const source = canvas(960, 2000);
    const pages = await generate(source, { pageSize: 'full' }, watermark);
    expect(pages).toHaveLength(1);
    expect(pages[0].widthPt).toBeCloseTo(720);
    expect(pages[0].heightPt).toBeCloseTo(1500);
    expect(pages[0]).toMatchObject({
      watermark,
      image: { canvas: source, xPt: 0, yPt: 0 },
    });
    expect(pages[0].image.wPt).toBeCloseTo(pages[0].widthPt);
    expect(pages[0].image.hPt).toBeCloseTo(pages[0].heightPt);
    expect(source.getContext).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledExactlyOnceWith({
      url: 'blob:watermarked-pdf',
      filename,
      saveAs: false,
    });
  });

  it.each([
    { pageSize: 'a4' as const, orientation: 'portrait' as const, widthMm: 210, heightMm: 297 },
    {
      pageSize: 'letter' as const,
      orientation: 'landscape' as const,
      widthMm: 279.4,
      heightMm: 215.9,
    },
  ])('marks the centered single $pageSize page', async (layout) => {
    const source = canvas(960, 3000);
    const pages = await generate(source, layout, watermark);
    expect(pages).toHaveLength(1);
    const page = pages[0];
    expect(page.watermark).toBe(watermark);
    expect(page.widthPt).toBeCloseTo((layout.widthMm * 72) / 25.4);
    expect(page.heightPt).toBeCloseTo((layout.heightMm * 72) / 25.4);
    expect(page.image.canvas).toBe(source);
    expect(page.image.xPt * 2 + page.image.wPt).toBeCloseTo(page.widthPt);
    expect(page.image.yPt * 2 + page.image.hPt).toBeCloseTo(page.heightPt);
    expect(source.getContext).not.toHaveBeenCalled();
  });

  it.each(['a4', 'letter'] as const)(
    'forwards the exact watermark on every %s tile, including the short final page',
    async (pageSize) => {
      const source = canvas(960, 3000);
      const progress = vi.fn();
      const pages = await generate(source, { pageSize, multiPage: true }, watermark, progress);
      expect(pages.length).toBeGreaterThan(1);
      const first = pages[0];
      const last = pages.at(-1)!;
      expect(last.image.canvas.height).toBeLessThan(first.image.canvas.height);
      expect(last.image.hPt).toBeLessThan(first.image.hPt);
      for (const page of pages) {
        expect(page.watermark).toBe(watermark);
        expect(page.widthPt).toBe(first.widthPt);
        expect(page.heightPt).toBe(first.heightPt);
        expect(page.image.canvas).not.toBe(source);
        expect(page.image.canvas.width).toBe(source.width);
      }
      expect(progress.mock.calls.map(([value]) => value)).toEqual(
        pages.map((_, index) => ({ page: index + 1, total: pages.length })),
      );
      expect(source.getContext).not.toHaveBeenCalled();
    },
  );

  it('marks the single page when multi-page is enabled but the image fits', async () => {
    const source = canvas(960, 300);
    const progress = vi.fn();
    const pages = await generate(source, { multiPage: true }, watermark, progress);
    expect(pages).toHaveLength(1);
    expect(pages[0].watermark).toBe(watermark);
    expect(pages[0].image.canvas).toBe(source);
    expect(progress).not.toHaveBeenCalled();
  });

  it.each([
    { pageSize: 'full' as const },
    { pageSize: 'a4' as const },
    { pageSize: 'letter' as const, multiPage: true },
  ])('keeps the unmarked $pageSize export free of watermark data', async (opts) => {
    const pages = await generate(canvas(960, 3000), opts);
    for (const page of pages) {
      expect(page).not.toHaveProperty('watermark');
      expect(page.image.canvas.width).toBe(960);
    }
    expect(buildPdf).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledExactlyOnceWith({
      url: 'blob:watermarked-pdf',
      filename,
      saveAs: false,
    });
  });
});
