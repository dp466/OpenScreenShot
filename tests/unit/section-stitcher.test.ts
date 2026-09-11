import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stitchCaptureSection } from '../../src/background/section-stitcher';

function png(width = 800, height = 600) {
  // Minimal PNG envelope for the bounded decoder boundary. The browser bitmap
  // decoder is mocked separately; validation/placement/export are real code.
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new DataView(bytes.buffer);
  header.setUint32(8, 13);
  header.setUint32(12, 0x49484452);
  header.setUint32(16, width);
  header.setUint32(20, height);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

let canvases: FakeCanvas[];
let bitmaps: Array<{ width: number; height: number; close: ReturnType<typeof vi.fn> }>;
let createBitmap: ReturnType<typeof vi.fn>;
let network: ReturnType<typeof vi.fn>;
let exportedBytes: Uint8Array;
class FakeCanvas {
  width: number;
  height: number;
  drawImage = vi.fn();
  convertToBlob = vi.fn(
    async () => new Blob([new Uint8Array(exportedBytes)], { type: 'image/png' }),
  );
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    canvases.push(this);
  }
  getContext() {
    return { drawImage: this.drawImage };
  }
}

beforeEach(() => {
  canvases = [];
  bitmaps = [];
  exportedBytes = Uint8Array.from({ length: 60_123 }, (_, i) => i % 256);
  network = vi.fn(() => {
    throw new Error('Network requests are forbidden');
  });
  createBitmap = vi.fn(async (blob: Blob) => {
    expect(blob.type).toBe('image/png');
    const view = new DataView(await blob.arrayBuffer());
    const bitmap = { width: view.getUint32(16), height: view.getUint32(20), close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local service-worker section stitching', () => {
  it('composes overlapping tiles, retaining negative offsets across a section boundary', async () => {
    const result = await stitchCaptureSection(
      [
        { dataUrl: png(), y: -100 },
        { dataUrl: png(), y: 440 },
      ],
      800,
      1000,
      null,
    );
    expect(canvases[0].drawImage.mock.calls).toEqual([
      [bitmaps[0], 0, -100],
      [bitmaps[1], 0, 440],
    ]);
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
    expect(canvases[0].convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
    expect(network).not.toHaveBeenCalled();
    // More than two base64 chunks, including a partial final chunk: no padding
    // may be inserted between independently encoded chunks.
    const decoded = Uint8Array.from(atob(result.split(',')[1]), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(exportedBytes);
  });

  it('crops each viewport to the selected inner scrolling region', async () => {
    await stitchCaptureSection([{ dataUrl: png(), y: 0 }], 700, 500, {
      x: 20,
      y: 40,
      w: 700,
      h: 500,
    });
    expect(canvases[0].drawImage).toHaveBeenCalledWith(
      bitmaps[0],
      20,
      40,
      700,
      500,
      0,
      0,
      700,
      500,
    );
  });

  it.each([
    'https://private.example/screenshot.png',
    'data:image/jpeg;base64,AA==',
    'data:image/png;base64,',
    'data:image/png;base64,***',
    'data:image/png;base64,aGVsbG8=',
  ])(
    'rejects invalid/non-local input without invoking a network or image decoder: %s',
    async (dataUrl) => {
      await expect(stitchCaptureSection([{ dataUrl, y: 0 }], 800, 600, null)).rejects.toThrow();
      expect(createBitmap).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
      expect(canvases[0].width).toBe(0);
      expect(canvases[0].height).toBe(0);
    },
  );

  it.each([
    [0, 600],
    [800, 0],
    [32001, 600],
    [800, 32001],
    [9000, 9000],
  ])('rejects oversized or empty PNG dimensions %ix%i before decoding', async (width, height) => {
    await expect(
      stitchCaptureSection([{ dataUrl: png(width, height), y: 0 }], 800, 600, null),
    ).rejects.toThrow('dimensions');
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it.each([
    [0, 600],
    [800, 0],
    [32001, 600],
    [800, 16001],
    [4000, 9000],
    [1.5, 600],
  ])(
    'rejects unsupported section dimensions %ix%i before canvas allocation',
    async (width, height) => {
      await expect(
        stitchCaptureSection([{ dataUrl: png(), y: 0 }], width, height, null),
      ).rejects.toThrow('canvas dimensions');
      expect(canvases).toHaveLength(0);
    },
  );

  it('releases the first decoded bitmap and canvas if the next tile fails to decode', async () => {
    createBitmap
      .mockImplementationOnce(createBitmap.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('Invalid compressed PNG'));
    await expect(
      stitchCaptureSection(
        [
          { dataUrl: png(), y: 0 },
          { dataUrl: png(), y: 500 },
        ],
        800,
        1000,
        null,
      ),
    ).rejects.toThrow('Invalid compressed PNG');
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
    expect(canvases[0].convertToBlob).not.toHaveBeenCalled();
  });

  it('rejects a crop extending past captured pixels and releases the bitmap', async () => {
    await expect(
      stitchCaptureSection([{ dataUrl: png(), y: 0 }], 700, 500, { x: 150, y: 40, w: 700, h: 500 }),
    ).rejects.toThrow('extends outside');
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(canvases[0].drawImage).not.toHaveBeenCalled();
    expect(canvases[0].width).toBe(0);
  });

  it('rejects source images narrower than the output to prevent transparent columns', async () => {
    await expect(
      stitchCaptureSection([{ dataUrl: png(700), y: 0 }], 800, 600, null),
    ).rejects.toThrow('narrower');
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
  });

  it('releases the backing canvas when encoding fails', async () => {
    vi.spyOn(FakeCanvas.prototype, 'getContext').mockImplementation(function (this: FakeCanvas) {
      this.convertToBlob.mockRejectedValueOnce(new Error('Encoder failed'));
      return { drawImage: this.drawImage };
    });
    await expect(stitchCaptureSection([{ dataUrl: png(), y: 0 }], 800, 600, null)).rejects.toThrow(
      'Encoder failed',
    );
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  });
});
