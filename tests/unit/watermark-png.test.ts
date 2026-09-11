import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageBlob, watermarkPng } from '../../src/capture-results/export';

const drawing = vi.hoisted(() => ({ drawWatermark: vi.fn(), ensureWatermarkFont: vi.fn() }));
vi.mock('../../src/shared/watermark', () => drawing);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('watermarkPng', () => {
  it('draws an export copy with original dimensions and releases the bitmap and canvas', async () => {
    const source = 'data:image/png;base64,AAAA';
    const encoded = new Blob(['encoded'], { type: 'image/png' });
    const close = vi.fn();
    const bitmap = { width: 80, height: 120, close };
    const drawImage = vi.fn();
    const context = { drawImage };
    const dimensions: number[][] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void, type: string) => {
        dimensions.push([canvas.width, canvas.height]);
        expect(type).toBe('image/png');
        callback(encoded);
      },
    };
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No network allowed');
      }),
    );

    expect(await watermarkPng(source, 'Équipe Québec')).toBe(encoded);
    expect(await createImageBitmap.mock.calls[0][0].arrayBuffer()).toEqual(
      await imageBlob(source).arrayBuffer(),
    );
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(drawing.drawWatermark).toHaveBeenCalledWith(context, 'Équipe Québec', 80, 120);
    expect(dimensions).toEqual([[80, 120]]);
    expect(close).toHaveBeenCalledOnce();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cleans up decoded images even when encoding fails', async () => {
    const close = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(null),
    };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 2, close })),
    );
    vi.stubGlobal('document', { createElement: () => canvas });
    await expect(watermarkPng('data:image/png;base64,AAAA', 'Capture')).rejects.toThrow('encode');
    expect(close).toHaveBeenCalledOnce();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('validates the local PNG before decoding and returns unnamed image bytes unchanged', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(watermarkPng('https://example.test/capture.png', 'Capture')).rejects.toThrow(
      'Invalid local',
    );
    const source = 'data:image/png;base64,AAEC';
    const output = await watermarkPng(source, '  ');
    expect(await output.arrayBuffer()).toEqual(await imageBlob(source).arrayBuffer());
    expect(decode).not.toHaveBeenCalled();
    expect(drawing.drawWatermark).not.toHaveBeenCalled();
  });
});
