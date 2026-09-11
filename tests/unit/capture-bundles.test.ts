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

  it.each([true, false])('persists the requestFilename snapshot as %s', async (requestFilename) => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle({ ...input, requestFilename });
    expect(bundle.requestFilename).toBe(requestFilename);
    expect(store.get(`openscreenshot:capture-bundle:${bundle.id}`)).toHaveProperty(
      'requestFilename',
      requestFilename,
    );
    expect(await api.getCaptureBundle(bundle.id)).toHaveProperty(
      'requestFilename',
      requestFilename,
    );
    expect(await api.listCaptureBundles()).toEqual([expect.objectContaining({ requestFilename })]);
  });

  it('keeps absent naming properties absent when reopening and finishing a legacy capture', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    await api.appendCapturePart(bundle.id, section);
    await api.finishCaptureBundle(bundle.id, { height: 1000, warnings: [], incomplete: false });

    for (const capture of [
      bundle,
      store.get(`openscreenshot:capture-bundle:${bundle.id}`),
      await api.getCaptureBundle(bundle.id),
      ...(await api.listCaptureBundles()),
    ]) {
      expect(capture).not.toHaveProperty('requestFilename');
      expect(capture).not.toHaveProperty('exportName');
    }
  });

  it('preserves the canonical name while writing only metadata and preserving every image and thumbnail', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const { makeThumbnail } = await import('../../src/shared/thumbnail');
    vi.mocked(makeThumbnail)
      .mockResolvedValueOnce('first-thumb')
      .mockResolvedValueOnce('second-thumb');
    const bundle = await api.createCaptureBundle({ ...input, requestFilename: true });
    const secondPng = 'data:image/png;base64,BBBB';
    await api.appendCapturePart(bundle.id, section);
    await api.appendCapturePart(bundle.id, {
      ...section,
      dataUrl: secondPng,
      height: 500,
      y: 1000,
    });
    const key = `openscreenshot:capture-bundle:${bundle.id}`;
    const before = structuredClone(store.get(key) as object);
    const previousKeys = [...store.keys()];
    const previousIndex = structuredClone(store.get('openscreenshot:capture-bundles'));
    vi.mocked(chrome.storage.local.set).mockClear();
    vi.mocked(chrome.storage.local.remove).mockClear();
    vi.mocked(makeThumbnail).mockClear();

    const renamed = await api.setCaptureExportName(bundle.id, 'Café rapport.pdf');

    expect(renamed).toEqual({ ...before, exportName: 'Café rapport.pdf' });
    expect(await api.getCaptureBundle(bundle.id)).toEqual(renamed);
    expect(await api.listCaptureBundles()).toEqual([renamed]);
    expect(chrome.storage.local.set).toHaveBeenCalledExactlyOnceWith({ [key]: renamed });
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(makeThumbnail).not.toHaveBeenCalled();
    expect([...store.keys()]).toEqual(previousKeys);
    expect(store.get('openscreenshot:capture-bundles')).toEqual(previousIndex);
    expect(renamed.parts.map((part) => part.thumbnail)).toEqual(['first-thumb', 'second-thumb']);
    expect(await api.readCapturePart(bundle.id, 0)).toBe(png);
    expect(await api.readCapturePart(bundle.id, 1)).toBe(secondPng);
  });

  it.each(['', '   ', ' padded ', 'folder/report', 'CON', 'x'.repeat(121), 'report\u0000'])(
    'rejects invalid name %j without changing stored capture data',
    async (name) => {
      const api = await import('../../src/shared/capture-bundles');
      const { ExportNameError } = await import('../../src/shared/export-name');
      const bundle = await api.createCaptureBundle(input);
      await api.appendCapturePart(bundle.id, section);
      await api.setCaptureExportName(bundle.id, 'Existing name');
      const before = structuredClone([...store.entries()]);
      vi.mocked(chrome.storage.local.set).mockClear();
      vi.mocked(chrome.storage.local.remove).mockClear();

      await expect(api.setCaptureExportName(bundle.id, name)).rejects.toBeInstanceOf(
        ExportNameError,
      );

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      expect([...store.entries()]).toEqual(before);
    },
  );

  it('rejects renaming a missing capture without creating metadata or an index entry', async () => {
    const api = await import('../../src/shared/capture-bundles');

    await expect(api.setCaptureExportName('missing-capture', 'Report')).rejects.toThrow(
      'no longer available',
    );

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it.each([
    ['rename', 'append', 'finish'],
    ['append', 'rename', 'finish'],
    ['append', 'finish', 'rename'],
  ] as const)('serializes concurrent %s, %s, %s without losing capture state', async (...order) => {
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal('navigator', { locks: { request } });
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle({ ...input, requestFilename: true });
    await api.appendCapturePart(bundle.id, section);
    request.mockClear();
    const operations = {
      rename: () => api.setCaptureExportName(bundle.id, 'Concurrent report.pdf'),
      append: () => api.appendCapturePart(bundle.id, { ...section, height: 500, y: 1000 }),
      finish: () =>
        api.finishCaptureBundle(bundle.id, {
          height: 1500,
          warnings: ['A capture warning', 'A capture warning'],
          incomplete: false,
        }),
    };

    await Promise.all(order.map((operation) => operations[operation]()));

    const saved = await api.getCaptureBundle(bundle.id);
    expect(saved).toMatchObject({
      requestFilename: true,
      exportName: 'Concurrent report.pdf',
      width: 100,
      height: 1500,
      incomplete: false,
      warnings: ['A capture warning'],
      finishedAt: expect.any(Number),
      parts: [
        { index: 0, width: 100, height: 1000, y: 0, thumbnail: 'thumb' },
        { index: 1, width: 100, height: 500, y: 1000, thumbnail: 'thumb' },
      ],
    });
    expect(request).toHaveBeenCalledTimes(3);
    for (const call of request.mock.calls) {
      expect(call).toEqual(['openscreenshot:capture-bundles', expect.any(Function)]);
    }
    expect(await api.readCapturePart(bundle.id, 0)).toBe(png);
    expect(await api.readCapturePart(bundle.id, 1)).toBe(png);
  });

  it('allows a completed capture to be renamed without reopening it or changing its completion data', async () => {
    const api = await import('../../src/shared/capture-bundles');
    const bundle = await api.createCaptureBundle(input);
    await api.appendCapturePart(bundle.id, section);
    await api.finishCaptureBundle(bundle.id, {
      height: 1000,
      warnings: ['Stopped early'],
      incomplete: true,
    });
    const before = await api.getCaptureBundle(bundle.id);

    await api.setCaptureExportName(bundle.id, 'Final report.pdf');

    expect(await api.getCaptureBundle(bundle.id)).toEqual({
      ...before,
      exportName: 'Final report.pdf',
    });
    expect(await api.listCaptureBundles()).toEqual([{ ...before, exportName: 'Final report.pdf' }]);
    await expect(api.appendCapturePart(bundle.id, { ...section, y: 1000 })).rejects.toThrow(
      'already finished',
    );
    expect(await api.readCapturePart(bundle.id, 0)).toBe(png);
  });
});
