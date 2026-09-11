/**
 * Minimal PDF writer — replaces jsPDF (386KB) for our one use case: laying
 * out raster screenshots onto pages. We only ever place images, so this emits
 * a bare PDF with one screenshot image XObject per page and an optional small,
 * alpha-masked watermark image at the physical page's bottom-right.
 *
 * Images are stored losslessly as raw DeviceRGB samples under /FlateDecode,
 * compressed with the browser-native CompressionStream (no zlib dependency).
 * Alpha is composited onto white, matching the opaque page background.
 *
 * PDF coordinates are points (1/72") with a bottom-left origin; callers pass
 * top-left placements and we flip the y-axis here.
 */
import { drawWatermark, ensureWatermarkFont } from '../shared/watermark';

export interface PlacedImage {
  canvas: HTMLCanvasElement;
  xPt: number;
  yPt: number; // top-left origin; flipped internally
  wPt: number;
  hPt: number;
}

export interface PdfPage {
  widthPt: number;
  heightPt: number;
  image: PlacedImage;
  watermark?: string;
}

const enc = new TextEncoder();

/** Trim a number to at most 4 decimals with no trailing zeros or exponent. */
function fmt(x: number): string {
  return x.toFixed(4).replace(/\.?0+$/, '') || '0';
}

/** zlib-wrap + deflate via the platform stream (PDF /FlateDecode == zlib). */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

interface EncodedImage {
  width: number;
  height: number;
  data: Uint8Array<ArrayBuffer>;
}

/** Canvas → white-composited RGB → FlateDecode stream. Exported for tests. */
export async function encodeImage(canvas: HTMLCanvasElement): Promise<EncodedImage> {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const { data } = ctx.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3];
    if (a === 255) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    } else {
      const af = a / 255;
      const inv = 255 * (1 - af);
      rgb[j] = data[i] * af + inv;
      rgb[j + 1] = data[i + 1] * af + inv;
      rgb[j + 2] = data[i + 2] * af + inv;
    }
  }
  return { width, height, data: await deflate(rgb) };
}

interface EncodedWatermark extends EncodedImage {
  alpha: Uint8Array<ArrayBuffer>;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
}

/** Only a narrow footer strip is rasterized, never a second page-sized canvas. */
async function encodeWatermark(page: PdfPage, text: string): Promise<EncodedWatermark> {
  await ensureWatermarkFont(text);
  const margin = Math.min(12, page.widthPt / 8, page.heightPt / 8);
  const wPt = Math.min(1200, page.widthPt - 2 * margin);
  const hPt = Math.min(36, page.heightPt - 2 * margin);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(wPt * 2));
  canvas.height = Math.max(1, Math.ceil(hPt * 2));
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    drawWatermark(ctx, text, canvas.width, canvas.height, { margin: 0, padding: 8, fontSize: 20 });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    const alpha = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0, j = 0, pixel = 0; i < data.length; i += 4, j += 3, pixel++) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
      alpha[pixel] = data[i + 3];
    }
    return {
      width: canvas.width,
      height: canvas.height,
      data: await deflate(rgb),
      alpha: await deflate(alpha),
      xPt: page.widthPt - margin - wPt,
      yPt: margin,
      wPt,
      hPt,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

class ByteBuffer {
  private parts: Uint8Array<ArrayBuffer>[] = [];
  len = 0;
  push(u8: Uint8Array<ArrayBuffer>): void {
    this.parts.push(u8);
    this.len += u8.length;
  }
  ascii(s: string): void {
    this.push(enc.encode(s));
  }
  blob(): Blob {
    return new Blob(this.parts, { type: 'application/pdf' });
  }
}

export async function buildPdf(pages: PdfPage[]): Promise<Blob> {
  return buildPdfSequential(pages, pages.length);
}

/**
 * Pull and encode one page at a time. An async generator can free its page
 * canvas and current section bitmap before reading the next section; only
 * compressed PDF objects accumulate. No full-document canvas is allocated.
 */
export async function buildPdfSequential(
  pages: AsyncIterable<PdfPage> | Iterable<PdfPage>,
  pageCount: number,
): Promise<Blob> {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error('PDF export needs at least one page.');
  }
  // Keep core object numbers stable; optional watermark + mask objects follow
  // those reserved IDs so streaming/mixed pages need no advance materialization.
  let nextExtraObject = 3 + pageCount * 3;
  const offsets: number[] = new Array(nextExtraObject).fill(0);
  const b = new ByteBuffer();

  b.ascii('%PDF-1.7\n');
  b.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker

  const startObj = (num: number) => {
    offsets[num] = b.len;
  };

  startObj(1);
  b.ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObj(2);
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i * 3} 0 R`).join(' ');
  b.ascii(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>\nendobj\n`);

  let i = 0;
  for await (const p of pages) {
    if (i >= pageCount) throw new Error('PDF page count changed during export.');
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imgNum = pageNum + 2;
    const img = await encodeImage(p.image.canvas);
    const watermark = p.watermark?.trim() ? await encodeWatermark(p, p.watermark) : undefined;
    const watermarkNum = watermark ? nextExtraObject++ : 0;
    const maskNum = watermark ? nextExtraObject++ : 0;
    const { image } = p;
    const yFlip = p.heightPt - image.yPt - image.hPt;
    let content =
      `q\n${fmt(image.wPt)} 0 0 ${fmt(image.hPt)} ${fmt(image.xPt)} ${fmt(yFlip)} cm\n` +
      `/Im0 Do\nQ\n`;
    if (watermark) {
      content +=
        `q\n${fmt(watermark.wPt)} 0 0 ${fmt(watermark.hPt)} ` +
        `${fmt(watermark.xPt)} ${fmt(watermark.yPt)} cm\n/Wm0 Do\nQ\n`;
    }
    const contentBytes = enc.encode(content);

    startObj(pageNum);
    b.ascii(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${fmt(p.widthPt)} ${fmt(p.heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${imgNum} 0 R ` +
        (watermark ? `/Wm0 ${watermarkNum} 0 R ` : '') +
        `>> >> ` +
        `/Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    startObj(contentNum);
    b.ascii(`${contentNum} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    b.push(contentBytes);
    b.ascii('\nendstream\nendobj\n');

    startObj(imgNum);
    b.ascii(
      `${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image ` +
        `/Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /FlateDecode /Length ${img.data.length} >>\nstream\n`,
    );
    b.push(img.data);
    b.ascii('\nendstream\nendobj\n');
    if (watermark) {
      startObj(watermarkNum);
      b.ascii(
        `${watermarkNum} 0 obj\n<< /Type /XObject /Subtype /Image ` +
          `/Width ${watermark.width} /Height ${watermark.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${maskNum} 0 R ` +
          `/Filter /FlateDecode /Length ${watermark.data.length} >>\nstream\n`,
      );
      b.push(watermark.data);
      b.ascii('\nendstream\nendobj\n');

      startObj(maskNum);
      b.ascii(
        `${maskNum} 0 obj\n<< /Type /XObject /Subtype /Image ` +
          `/Width ${watermark.width} /Height ${watermark.height} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 ` +
          `/Filter /FlateDecode /Length ${watermark.alpha.length} >>\nstream\n`,
      );
      b.push(watermark.alpha);
      b.ascii('\nendstream\nendobj\n');
    }
    i++;
  }
  if (i !== pageCount) throw new Error('PDF page count changed during export.');

  const xrefOff = b.len;
  const objCount = nextExtraObject - 1;
  b.ascii(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objCount; i++) {
    b.ascii(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  b.ascii(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`);

  return b.blob();
}
