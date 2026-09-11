import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureBundle } from '../../src/shared/capture-bundles';

vi.mock('../../src/background/recording', () => ({ restoreRecBadge: vi.fn() }));
vi.mock('../../src/background/section-stitcher', () => ({
  stitchCaptureSection: vi.fn(async (_tiles: unknown, _width: number, height: number) => {
    events.push('stitchCaptureSection');
    if (failAt === 'stitchCaptureSection') throw new Error('stitch failed');
    stitchedHeights.push(height);
    return 'data:image/png;base64,finished';
  }),
}));
vi.mock('../../src/shared/storage', () => ({
  getSettings: async () => ({
    captureDelay: 0,
    captureAction,
    filenameWatermark,
    expressMode: true,
    scrollDelayMs: 1500,
    waitForImages: true,
    imageWaitTimeoutMs: 10000,
    longPageOutput: 'pdf',
  }),
  getLastRegion: async () => ({ x: 20, y: 20, width: 100, height: 100 }),
  setLastRegion: vi.fn(),
  setLastCapture: vi.fn(),
  setSettings: vi.fn(),
  migrateExpressDefault: vi.fn(),
  onSettingsChanged: vi.fn(),
}));
vi.mock('../../src/shared/capture-bundles', () => ({
  createCaptureBundle: vi.fn(async (input: Pick<CaptureBundle, 'title' | 'url' | 'output'>) => {
    bundle = {
      ...input,
      id: 'local-test-capture',
      width: 0,
      height: 0,
      parts: [],
      warnings: [],
      incomplete: true,
      createdAt: Date.now(),
    };
    return bundle;
  }),
  appendCapturePart: vi.fn(
    async (
      _id: string,
      input: {
        dataUrl: string;
        width: number;
        height: number;
        y: number;
      },
    ) => {
      const part = {
        index: bundle!.parts.length,
        width: input.width,
        height: input.height,
        y: input.y,
      };
      partData.push(input.dataUrl);
      bundle!.parts.push(part);
      bundle!.width = input.width;
      bundle!.height = input.y + input.height;
      return part;
    },
  ),
  finishCaptureBundle: vi.fn(
    async (
      _id: string,
      input: {
        height: number;
        warnings: string[];
        incomplete: boolean;
      },
    ) => {
      Object.assign(bundle!, input);
      finishedBundle = structuredClone(bundle);
    },
  ),
  getCaptureBundle: vi.fn(async () => bundle),
  readCapturePart: vi.fn(async (_id: string, index: number) => partData[index]),
  deleteCaptureBundle: vi.fn(async () => {
    bundle = null;
  }),
}));

// Chrome is the external boundary: record injection/capture ordering while the
// real worker runs all lifecycle branches, timers, progress and delivery.
let events: string[];
let messages: Array<{ type: string }>;
let listener: (message: unknown) => void;
let failAt: string | undefined;
let captures: number;
let overlayVisible: boolean;
let fakeChrome: ReturnType<typeof makeChrome>;
let bundle: CaptureBundle | null;
let finishedBundle: CaptureBundle | null;
let partData: string[];
let activeTabId: number;
let switchOnScroll: boolean;
let switchAfterSnapshot: number | undefined;
let destinations: string[];
let scrollPositions: number[];
let scrollArguments: unknown[][];
let stitchedHeights: number[];
let pageHeight: number;
let closeOnSecondScroll: boolean;
let pageUnavailable: boolean;
let regionLabels: unknown;
let filenameWatermark: boolean;
let captureAction: 'editor' | 'download' | 'clipboard';
function makeChrome() {
  const noop = vi.fn(async () => undefined);
  return {
    runtime: {
      onInstalled: { addListener: noop },
      onStartup: { addListener: noop },
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
      getURL: (path: string) => path,
      getManifest: () => ({ version: '2' }),
      setUninstallURL: noop,
      sendMessage: async (message: { type: string }) => {
        messages.push(message);
      },
    },
    action: {
      onClicked: { addListener: noop },
      setPopup: noop,
      setBadgeBackgroundColor: noop,
      setBadgeTextColor: noop,
      setBadgeText: noop,
      setTitle: noop,
      getTitle: async () => 'Title',
    },
    commands: { onCommand: { addListener: noop } },
    contextMenus: { onClicked: { addListener: noop }, update: noop, create: noop },
    i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    windows: { WINDOW_ID_CURRENT: -2 },
    downloads: { download: vi.fn(async () => 1) },
    tabs: {
      query: async () =>
        pageUnavailable
          ? []
          : [{ id: activeTabId, windowId: 1, url: 'https://example.com', title: 'Example' }],
      create: async ({ url }: { url: string }) => {
        events.push('deliver');
        destinations.push(url);
        if (failAt === 'deliver') throw new Error('delivery failed');
      },
      captureVisibleTab: async () => {
        events.push('snapshot');
        expect(overlayVisible, 'overlay must never be visible in captured pixels').toBe(false);
        captures++;
        if (failAt === `snapshot:${captures}`) throw new Error('capture failed');
        if (captures === switchAfterSnapshot) activeTabId = 8;
        return 'data:image/png;base64,tile';
      },
    },
    scripting: {
      executeScript: async ({
        func,
        args,
      }: {
        func: (...args: never[]) => unknown;
        args: unknown[];
      }) => {
        const name = func.name;
        const event = name === 'updateCaptureOverlay' ? `overlay:${args[0]}` : name;
        events.push(event);
        if (name === 'scrollAndWait' && closeOnSecondScroll && scrollPositions.length === 1) {
          pageUnavailable = true;
          overlayVisible = false;
        }
        if (pageUnavailable) throw new Error('The source tab closed.');
        if (event === failAt) throw new Error('injection failed');
        if (name === 'updateCaptureOverlay') overlayVisible = args[0] === 'show';
        let result: unknown;
        if (name === 'getMetrics')
          result = {
            viewportWidth: 800,
            viewportHeight: 600,
            scrollHeight: pageHeight,
            devicePixelRatio: 1,
            container: null,
          };
        if (name === 'scrollToPosition') result = { scrollY: args[0], atBottom: false };
        if (name === 'scrollAndWait') {
          scrollArguments.push(args);
          const scrollY = Math.min(Math.max(0, pageHeight - 600), Math.max(0, Number(args[0])));
          scrollPositions.push(scrollY);
          if (switchOnScroll) activeTabId = 8;
          result = {
            viewportWidth: 800,
            viewportHeight: 600,
            scrollHeight: pageHeight,
            devicePixelRatio: 1,
            container: null,
            scrollY,
            atBottom: scrollY >= pageHeight - 600,
            timedOut: false,
            pendingImages: 0,
            failedImages: 0,
            cancelled: false,
          };
        }
        if (name === 'selectRegion') {
          regionLabels = args[0];
          result = { x: 20, y: 20, width: 100, height: 100 };
        }
        if (name === 'cropTile') result = 'data:image/png;base64,finished';
        return [{ result }];
      },
    },
  };
}
async function capture(mode = 'full-page') {
  listener({ type: 'CAPTURE_REQUEST', mode });
  await vi.runAllTimersAsync();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  events = [];
  messages = [];
  captures = 0;
  overlayVisible = false;
  failAt = undefined;
  bundle = null;
  finishedBundle = null;
  partData = [];
  activeTabId = 7;
  switchOnScroll = false;
  switchAfterSnapshot = undefined;
  destinations = [];
  scrollPositions = [];
  scrollArguments = [];
  stitchedHeights = [];
  pageHeight = 1500;
  closeOnSecondScroll = false;
  pageUnavailable = false;
  filenameWatermark = false;
  captureAction = 'editor';
  fakeChrome = makeChrome();
  vi.stubGlobal('chrome', fakeChrome);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await import('../../src/background/index');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('screenshot capture overlay lifecycle', () => {
  it.each(
    ['full-page', 'visible', 'region'].flatMap((mode) =>
      (['editor', 'download', 'clipboard'] as const).map((action) => ({ mode, action })),
    ),
  )('defers $mode/$action delivery until the filename is chosen', async ({ mode, action }) => {
    filenameWatermark = true;
    captureAction = action;
    await capture(mode);
    expect(finishedBundle).toMatchObject({ requestFilename: true, mode, incomplete: false });
    expect(bundle?.parts).toHaveLength(1);
    expect(destinations).toEqual(['src/capture-results/index.html?id=local-test-capture']);
    expect(fakeChrome.downloads.download).not.toHaveBeenCalled();
    expect(events).not.toContain('copyImageToClipboard');
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(true);
    expect(events.at(-1)).toBe('overlay:remove');
    // Naming metadata must never be burned into the only saved original.
    expect(partData).toEqual([
      mode === 'visible' ? 'data:image/png;base64,tile' : 'data:image/png;base64,finished',
    ]);
  });

  it('retains all long-page sections for the end-of-capture naming prompt', async () => {
    filenameWatermark = true;
    pageHeight = 117812;
    await capture();
    expect(bundle).toMatchObject({ requestFilename: true, height: 117812, incomplete: false });
    expect(bundle!.parts.length).toBeGreaterThan(1);
    expect(destinations).toEqual(['src/capture-results/index.html?id=local-test-capture']);
    expect(fakeChrome.downloads.download).not.toHaveBeenCalled();
  });

  it('keeps the captured original if opening the naming screen fails', async () => {
    filenameWatermark = true;
    failAt = 'deliver';
    await capture('visible');
    expect(bundle?.parts).toHaveLength(1);
    expect(bundle?.incomplete).toBe(false);
    expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(true);
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(false);
  });

  it('shows progress between full-page tiles and hides before every snapshot', async () => {
    await capture();
    expect(captures).toBe(3);
    const snapshots = events.flatMap((event, index) => (event === 'snapshot' ? [index] : []));
    for (const index of snapshots) {
      expect(events[index - 1]).toBe('overlay:hide');
      expect(events.slice(index + 1).indexOf('overlay:show')).toBeGreaterThanOrEqual(0);
    }
    expect(events.indexOf('overlay:show')).toBeLessThan(snapshots[0]);
    expect(events.indexOf('stitchCaptureSection')).toBeLessThan(
      events.lastIndexOf('overlay:remove'),
    );
    expect(events.at(-1)).toBe('overlay:remove');
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(true);
  });

  it('stops at the actual bottom and does not allocate a transparent tail', async () => {
    await capture();
    expect(scrollPositions).toEqual([0, 540, 900, 900]);
    expect(captures).toBe(3);
    expect(stitchedHeights).toEqual([1500]);
    expect(finishedBundle).toMatchObject({ width: 800, height: 1500, incomplete: false });
    expect(destinations).toEqual(['src/editor/index.html']);
  });

  it('passes the configured scroll pause and image wait to every scroll step', async () => {
    await capture();
    expect(scrollArguments.length).toBeGreaterThan(1);
    for (const args of scrollArguments) {
      expect(args.slice(1)).toEqual([1500, true, 10000]);
    }
  });

  it('captures a 117,812 px page into bounded sections without reducing resolution', async () => {
    pageHeight = 117812;
    await capture();
    expect(finishedBundle).toMatchObject({
      width: 800,
      height: 117812,
      incomplete: false,
      warnings: [],
    });
    expect(finishedBundle?.parts).toHaveLength(8);
    expect(finishedBundle?.parts.at(-1)).toMatchObject({ y: 112000, height: 5812 });
    expect(stitchedHeights.reduce((total, height) => total + height, 0)).toBe(117812);
    expect(Math.max(...stitchedHeights)).toBeLessThanOrEqual(16000);
    expect(destinations).toEqual(['src/capture-results/index.html?id=local-test-capture']);
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(true);
    expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(false);
    expect(events.at(-1)).toBe('overlay:remove');
  });

  it('preserves completed pixels and marks a later capture failure as partial', async () => {
    failAt = 'snapshot:2';
    await capture();
    expect(captures).toBe(2);
    expect(finishedBundle).toMatchObject({ width: 800, height: 600, incomplete: true });
    expect(finishedBundle?.warnings).toContain('capture failed');
    expect(stitchedHeights).toEqual([600]);
    expect(destinations).toEqual(['src/capture-results/index.html?id=local-test-capture']);
    expect(events).toContain('restoreCapture');
    expect(events.at(-1)).toBe('overlay:remove');
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(true);
    expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(false);
  });

  it('takes no screenshot if the source tab is no longer active before capture', async () => {
    switchOnScroll = true;
    await capture();
    expect(captures).toBe(0);
    expect(partData).toEqual([]);
    expect(destinations).toEqual([]);
    expect(events).toContain('restoreCapture');
    expect(events.at(-1)).toBe('overlay:remove');
    expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(true);
  });

  it('saves the pending image section even if the source tab closes before the next scroll', async () => {
    closeOnSecondScroll = true;
    await capture();
    expect(pageUnavailable).toBe(true);
    expect(captures).toBe(1);
    expect(stitchedHeights).toEqual([600]);
    expect(partData).toEqual(['data:image/png;base64,finished']);
    expect(finishedBundle).toMatchObject({ width: 800, height: 600, incomplete: true });
    expect(finishedBundle?.warnings).toContain('The source tab closed.');
    expect(destinations).toEqual(['src/capture-results/index.html?id=local-test-capture']);
    expect(events).toContain('restoreCapture');
    expect(events.at(-1)).toBe('overlay:remove');
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(true);
    expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(false);
  });

  it('discards a screenshot if the active tab changes while Chrome captures it', async () => {
    switchAfterSnapshot = 2;
    await capture();
    expect(captures).toBe(2);
    // The second image may show the newly active tab; only the first is kept.
    expect(finishedBundle).toMatchObject({ width: 800, height: 600, incomplete: true });
    expect(finishedBundle?.warnings.some((warning) => warning.includes('switched tabs'))).toBe(
      true,
    );
    expect(stitchedHeights).toEqual([600]);
    expect(destinations).toEqual(['src/capture-results/index.html?id=local-test-capture']);
    expect(events).toContain('restoreCapture');
    expect(events.at(-1)).toBe('overlay:remove');
  });

  it.each(['snapshot:1', 'prepareCapture', 'overlay:show', 'stitchCaptureSection', 'deliver'])(
    'restores the page and removes the overlay when %s fails',
    async (stage) => {
      failAt = stage;
      await capture();
      expect(events).toContain('restoreCapture');
      expect(events.at(-1)).toBe('overlay:remove');
      expect(overlayVisible).toBe(false);
      expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(true);
      expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(false);
    },
  );

  it('removes the overlay even when restoring the page fails', async () => {
    failAt = 'restoreCapture';
    await capture();
    expect(events.at(-1)).toBe('overlay:remove');
    expect(overlayVisible).toBe(false);
  });

  it('aborts a snapshot when the overlay cannot be hidden', async () => {
    failAt = 'overlay:hide';
    await capture();
    expect(captures).toBe(0);
    expect(events.at(-1)).toBe('overlay:remove');
  });

  it('passes French region labels into the self-contained injected selector', async () => {
    await capture('region');
    expect(regionLabels).toEqual({ capture: 'Capturer', cancel: 'Annuler' });
  });

  it.each(['visible', 'region'])(
    'shows finishing for %s only after the clean snapshot',
    async (mode) => {
      await capture(mode);
      expect(captures).toBe(1);
      expect(events.indexOf('overlay:show')).toBeGreaterThan(events.indexOf('snapshot'));
      expect(events.at(-1)).toBe('overlay:remove');
      expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(true);
    },
  );

  it.each([
    ['visible', 'snapshot:1'],
    ['visible', 'deliver'],
    ['region', 'snapshot:1'],
    ['region', 'cropTile'],
    ['region', 'deliver'],
  ])('cleans up %s when %s fails', async (mode, stage) => {
    failAt = stage;
    await capture(mode);
    expect(events.at(-1)).toBe('overlay:remove');
    expect(overlayVisible).toBe(false);
    expect(messages.some((m) => m.type === 'CAPTURE_COMPLETE')).toBe(false);
    expect(messages.some((m) => m.type === 'CAPTURE_ERROR')).toBe(true);
  });

  it('ignores overlapping capture requests to protect tile and overlay ownership', async () => {
    listener({ type: 'CAPTURE_REQUEST', mode: 'full-page' });
    listener({ type: 'CAPTURE_REQUEST', mode: 'visible' });
    await vi.runAllTimersAsync();
    expect(captures).toBe(3);
    expect(messages.filter((m) => m.type === 'CAPTURE_COMPLETE')).toHaveLength(1);
  });
});
