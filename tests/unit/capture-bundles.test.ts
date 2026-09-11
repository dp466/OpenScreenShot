import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/thumbnail', () => ({ makeThumbnail: vi.fn(async () => 'thumb') }));

let store: Map<string, unknown>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) =>
          store.has(key) ? { [key]: structuredClone(store.get(key)) } : {},
        ),
        set: vi.fn(async (data: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(data)) store.set(key, structuredClone(value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        }),
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const input = {
  title: 'Private test page',
  url: 'https://private.example.test/',
  output: 'pdf' as const,
};
const png = 'data:image/png;base64,AAAA';
const section = { dataUrl: png, width: 100, height: 1000, y: 0 };

describe('local capture bundles', () => {
  it('persists sections separately, finishes metadata, and deletes all owned keys', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    const first = await api.appendCapturePart(bundle.id, section);
    const second = await api.appendCapturePart(bundle.id, { ...section, height: 500, y: 1000 });
    expect(first.index).toBe(0);
    expect(second.index).toBe(1);
    await api.finishCaptureBundle(bundle.id, { height: 1500, warnings: [], incomplete: false });
    const saved = await api.getCaptureBundle(bundle.id);
    expect(saved).toMatchObject({ width: 100, height: 1500, incomplete: false });
    expect(saved?.parts).toHaveLength(2);
    expect(JSON.stringify(saved)).not.toContain(png);
    expect(await api.readCapturePart(bundle.id, 0)).toBe(png);
    expect(await api.listCaptureBundles()).toHaveLength(1);
    await api.deleteCaptureBundle(bundle.id);
    expect(await api.getCaptureBundle(bundle.id)).toBeNull();
    expect(await api.listCaptureBundles()).toHaveLength(0);
    expect([...store.keys()]).toEqual(['openscreenshot:capture-bundles']);
  });

  it('preserves existing sections when the encoded data budget is reached', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    await api.appendCapturePart(bundle.id, section);
    const key = `openscreenshot:capture-bundle:${bundle.id}`;
    // Simulate a nearly full bundle without allocating a 256 MiB test string.
    store.set(key, {
      ...(store.get(key) as object),
      imageBytes: api.CAPTURE_BUNDLE_BYTES_LIMIT - 1,
    });
    await expect(api.appendCapturePart(bundle.id, { ...section, y: 1000 })).rejects.toThrow(
      '256 MiB',
    );
    expect(await api.readCapturePart(bundle.id, 0)).toBe(png);
    expect((await api.getCaptureBundle(bundle.id))?.parts).toHaveLength(1);
    expect(store.has(`openscreenshot:capture-part:${bundle.id}:1`)).toBe(false);
  });

  it('rejects gaps, inconsistent width, and writes after completion', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    await api.appendCapturePart(bundle.id, section);
    await expect(api.appendCapturePart(bundle.id, { ...section, y: 1001 })).rejects.toThrow(
      'without gaps',
    );
    await expect(
      api.appendCapturePart(bundle.id, { ...section, width: 200, y: 1000 }),
    ).rejects.toThrow('same width');
    await api.finishCaptureBundle(bundle.id, { height: 1000, warnings: [], incomplete: false });
    await expect(api.appendCapturePart(bundle.id, { ...section, y: 1000 })).rejects.toThrow(
      'already finished',
    );
  });

  it('never inflates captured height to include unsaved or transparent rows', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    await api.appendCapturePart(bundle.id, section);
    await api.finishCaptureBundle(bundle.id, {
      height: 117812,
      warnings: ['Stopped early'],
      incomplete: false,
    });
    expect(await api.getCaptureBundle(bundle.id)).toMatchObject({ height: 1000, incomplete: true });
    expect((await api.getCaptureBundle(bundle.id))?.warnings).toContain('Stopped early');
  });

  it('retains three previous completed captures and never evicts active capture data', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const active = await api.createCaptureBundle(input);
    await api.appendCapturePart(active.id, section);
    const completed: string[] = [];
    for (let i = 0; i < 5; i++) {
      const bundle = await api.createCaptureBundle(input);
      await api.appendCapturePart(bundle.id, section);
      await api.finishCaptureBundle(bundle.id, { height: 1000, warnings: [], incomplete: false });
      completed.push(bundle.id);
    }
    await api.createCaptureBundle(input);
    expect(await api.getCaptureBundle(completed[0])).toBeNull();
    expect(await api.getCaptureBundle(completed[1])).toBeNull();
    for (const id of completed.slice(2)) expect(await api.getCaptureBundle(id)).not.toBeNull();
    expect(await api.readCapturePart(active.id, 0)).toBe(png);
    expect(store.has(`openscreenshot:capture-part:${completed[0]}:0`)).toBe(false);
  });

  it('serializes concurrent creates without losing history entries', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundles = await Promise.all([
      api.createCaptureBundle(input),
      api.createCaptureBundle(input),
    ]);
    expect((await api.listCaptureBundles()).map((bundle) => bundle.id).sort()).toEqual(
      bundles.map((bundle) => bundle.id).sort(),
    );
  });

  it('does not accept an external image URL', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    await expect(
      api.appendCapturePart(bundle.id, { ...section, dataUrl: 'https://example.test/private.png' }),
    ).rejects.toThrow('local PNG');
    expect((await api.getCaptureBundle(bundle.id))?.parts).toHaveLength(0);
  });
});
