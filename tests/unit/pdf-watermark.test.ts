import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPdf, type PdfPage } from '../../src/editor/pdf-writer';

class WatermarkCanvas {
  width = 1;
  height = 1;
  context = {
    font: '12px sans-serif',
    textAlign: 'left',
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    fillRect() {},
    fillText: vi.fn(),
    measureText(text: string) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 12);
      return {
        width: Array.from(text).length * size * 0.62,
        actualBoundingBoxAscent: size * 0.84,
        actualBoundingBoxDescent: size * 0.22,
      };
    },
    getImageData: () => {
      const data = new Uint8ClampedArray(this.width * this.height * 4);
      // Include transparent and partially transparent pixels to exercise /SMask.
      for (let i = 0; i < data.length; i += 4) {
        data.set([20, 40, 60, ((i / 4) % 3) * 127], i);
      }
      return { data };
    },
  };

  getContext() {
    return this.context;
  }
}

function page(heightPt: number, imageHeightPt: number, watermark?: string): PdfPage {
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }),
    }),
  } as unknown as HTMLCanvasElement;
  return {
    widthPt: 595,
    heightPt,
    image: { canvas, xPt: 0, yPt: 0, wPt: 595, hPt: imageHeightPt },
    ...(watermark === undefined ? {} : { watermark }),
  };
}

async function pdfText(pages: PdfPage[]) {
  const bytes = new Uint8Array(await (await buildPdf(pages)).arrayBuffer());
  // One code unit per byte means string offsets remain actual PDF byte offsets.
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return { bytes, text };
}

function objectText(text: string, id: number): string {
  const marker = `${id} 0 obj\n`;
  const start = text.indexOf(`\n${marker}`) + 1;
  expect(start).toBeGreaterThan(0);
  return text.slice(start, text.indexOf('\nendobj', start));
}

function watermarkPlacements(text: string): number[][] {
  return [...text.matchAll(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\n\/Wm0 Do\nQ/g)].map(
    (match) => match.slice(1).map(Number),
  );
}

async function inflateObject(bytes: Uint8Array, text: string, id: number) {
  const start = text.indexOf(`\n${id} 0 obj\n`) + 1;
  const dataStart = text.indexOf('\nstream\n', start) + '\nstream\n'.length;
  const length = Number(text.slice(start, dataStart).match(/\/Length (\d+)/)?.[1]);
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(bytes.slice(dataStart, dataStart + length));
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

beforeEach(() => {
  vi.stubGlobal('document', {
    fonts: { load: vi.fn().mockResolvedValue([]) },
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe('canvas');
      return new WatermarkCanvas();
    }),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('PDF watermark', () => {
  it('anchors the watermark to the physical page bottom independently of screenshot height', async () => {
    const { text } = await pdfText([page(842, 200, '© Zoë'), page(842, 1800, '© Zoë')]);
    const placements = watermarkPlacements(text);
    expect(placements).toHaveLength(2);
    expect(placements[0]).toEqual(placements[1]);
    for (const [width, height, x, y] of placements) {
      expect(y).toBe(12);
      expect(x + width).toBeCloseTo(595 - 12, 4);
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThan(842 / 4);
    }
  });

  it('adapts the inset and raster size to fit a very small physical page', async () => {
    const smallPage = { ...page(10, 3, 'É'.repeat(120)), widthPt: 8 };
    const { text } = await pdfText([smallPage]);
    const placements = watermarkPlacements(text);
    expect(placements).toHaveLength(1);
    const [width, height, x, y] = placements[0];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(12);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(x + width).toBeLessThanOrEqual(8);
    expect(y + height).toBeLessThanOrEqual(10);
  });

  it('bounds the watermark raster on very wide custom pages while keeping it at the right edge', async () => {
    const widePage = { ...page(842, 200, 'Équipe Québec'), widthPt: 24000 };
    const { text } = await pdfText([widePage]);
    const [[width, height, x, y]] = watermarkPlacements(text);
    expect([width, height, x, y]).toEqual([1200, 36, 22788, 12]);
    const imageId = Number(objectText(text, 3).match(/\/Wm0 (\d+) 0 R/)?.[1]);
    const watermarkImage = objectText(text, imageId);
    expect(watermarkImage).toContain('/Width 2400 /Height 72');
  });

  it('adds RGB and grayscale alpha objects only to watermarked pages without moving core IDs', async () => {
    const { text } = await pdfText([
      page(842, 200, '© Zoë Nguyễn'),
      page(842, 400),
      page(842, 600, '© 李小龍'),
    ]);
    expect(text.match(/\/Wm0 Do/g)).toHaveLength(2);
    expect(text).toContain('/Kids [ 3 0 R 6 0 R 9 0 R ]');
    for (const [pageId, contentId, imageId] of [
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ]) {
      const body = objectText(text, pageId);
      expect(body).toContain(`/Contents ${contentId} 0 R`);
      expect(body).toContain(`/Im0 ${imageId} 0 R`);
    }
    expect(objectText(text, 6)).not.toContain('/Wm0');
    expect(objectText(text, 7)).not.toContain('/Wm0 Do');
    for (const pageId of [3, 9]) {
      const imageId = Number(objectText(text, pageId).match(/\/Wm0 (\d+) 0 R/)?.[1]);
      expect(imageId).toBeGreaterThan(11);
      const image = objectText(text, imageId);
      expect(image).toContain('/ColorSpace /DeviceRGB');
      const alphaId = Number(image.match(/\/SMask (\d+) 0 R/)?.[1]);
      expect(alphaId).toBeGreaterThan(11);
      expect(alphaId).not.toBe(imageId);
      const alpha = objectText(text, alphaId);
      expect(alpha).toContain('/ColorSpace /DeviceGray');
      expect(alpha).toContain('/BitsPerComponent 8');
      expect(alpha).toContain('/Filter /FlateDecode');
    }
  });

  it('writes valid byte offsets for every object in a mixed multipage PDF', async () => {
    const { text } = await pdfText([
      page(842, 200, '© Zoë Nguyễn'),
      page(842, 400),
      page(842, 600, '© 李小龍'),
    ]);
    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    const xrefLines = text.slice(startxref).split('\n');
    const totalEntries = Number(xrefLines[1].split(' ')[1]);
    expect(totalEntries).toBe(16); // 11 core objects + two image/mask pairs + free object 0.
    expect(xrefLines[2]).toBe('0000000000 65535 f ');
    for (let id = 1; id < totalEntries; id++) {
      const entry = xrefLines[id + 2];
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${id} 0 obj\n`.length)).toBe(`${id} 0 obj\n`);
    }
    expect(text).toContain(`/Size ${totalEntries} /Root 1 0 R`);
  });

  it('preserves the watermark alpha samples instead of flattening its background onto white', async () => {
    const { bytes, text } = await pdfText([page(842, 400, '© Amélie')]);
    const imageId = Number(objectText(text, 3).match(/\/Wm0 (\d+) 0 R/)?.[1]);
    const image = objectText(text, imageId);
    const alphaId = Number(image.match(/\/SMask (\d+) 0 R/)?.[1]);
    const rgb = await inflateObject(bytes, text, imageId);
    const alpha = await inflateObject(bytes, text, alphaId);
    expect(Array.from(rgb.slice(0, 9))).toEqual([20, 40, 60, 20, 40, 60, 20, 40, 60]);
    expect(Array.from(alpha.slice(0, 3))).toEqual([0, 127, 254]);
    expect(rgb.length).toBe(alpha.length * 3);
  });
});
