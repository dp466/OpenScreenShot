import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runFullPageSession,
  sectionHeightForWidth,
  type CaptureSessionOps,
  type ScrollFrame,
} from '../../src/background/full-page-session';
import type { Metrics, TileSpec } from '../../src/shared/types';

const metrics = (overrides: Partial<Metrics> = {}): Metrics => ({
  scrollHeight: 1_500,
  viewportHeight: 600,
  viewportWidth: 1_200,
  devicePixelRatio: 1,
  container: null,
  ...overrides,
});

function frameAt(
  page: Metrics,
  requested: number,
  overrides: Partial<ScrollFrame> = {},
): ScrollFrame {
  const scrollY = Math.max(0, Math.min(requested, page.scrollHeight - page.viewportHeight));
  return {
    ...page,
    scrollY,
    atBottom: scrollY >= page.scrollHeight - page.viewportHeight,
    pendingImages: 0,
    failedImages: 0,
    timedOut: false,
    cancelled: false,
    ...overrides,
  };
}

function harness(
  page: Metrics,
  scrollFrame: (requested: number, call: number) => ScrollFrame = (requested) =>
    frameAt(page, requested),
) {
  let current: ScrollFrame;
  const captures: { dataUrl: string; state: ScrollFrame }[] = [];
  const stitches: { tiles: TileSpec[]; width: number; height: number }[] = [];
  const saves: { dataUrl: string; width: number; height: number; y: number }[] = [];
  const ops = {
    scroll: vi.fn(async (requested: number) => {
      current = scrollFrame(requested, ops.scroll.mock.calls.length);
      return current;
    }),
    capture: vi.fn(async () => {
      const dataUrl = `data:image/png;base64,tile-${captures.length}`;
      captures.push({ dataUrl, state: { ...current } });
      return dataUrl;
    }),
    hideFixed: vi.fn(async () => undefined),
    progress: vi.fn(async (_covered: number, _total: number) => undefined),
    stitch: vi.fn(async (tiles: TileSpec[], width: number, height: number) => {
      stitches.push({ tiles, width, height });
      return `data:image/png;base64,section-${stitches.length}`;
    }),
    save: vi.fn(async (dataUrl: string, width: number, height: number, y: number) => {
      saves.push({ dataUrl, width, height, y });
    }),
  } satisfies CaptureSessionOps;
  return { ops, captures, stitches, saves };
}

afterEach(() => vi.restoreAllMocks());

describe('full-page session coverage', () => {
  it('uses actual clamped positions and checks the bottom without capturing it twice', async () => {
    const page = metrics();
    const h = harness(page);

    const result = await runFullPageSession(page, h.ops);

    expect(h.captures.map(({ state }) => state.scrollY)).toEqual([0, 540, 900]);
    expect(h.ops.scroll.mock.calls.map(([y]) => y)).toEqual([0, 540, 1_080, 900]);
    expect(h.stitches).toHaveLength(1);
    expect(h.saves.map(({ y, height }) => ({ y, height }))).toEqual([{ y: 0, height: 1_500 }]);
    expect(result).toEqual({ width: 1_200, height: 1_500, warnings: [], incomplete: false });
    expect(h.ops.hideFixed).toHaveBeenCalledTimes(1);
  });

  it('crops a page shorter than the viewport to its actual content height', async () => {
    const page = metrics({ scrollHeight: 321 });
    const h = harness(page);

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(h.ops.scroll).toHaveBeenCalledTimes(2);
    expect(h.ops.hideFixed).not.toHaveBeenCalled();
    expect(h.saves[0].height).toBe(321);
    expect(result.height).toBe(321);
    expect(result.incomplete).toBe(false);
  });

  it('continues when the settled bottom recheck discovers newly appended content', async () => {
    const page = metrics({ scrollHeight: 1_000 });
    const h = harness(page, (y, call) =>
      frameAt({ ...page, scrollHeight: call >= 3 ? 2_000 : 1_000 }, y),
    );

    const result = await runFullPageSession(page, h.ops);

    expect(h.captures.map(({ state }) => state.scrollY)).toEqual([0, 400, 940, 1_400]);
    expect(h.ops.scroll.mock.calls.map(([y]) => y)).toEqual([0, 540, 400, 940, 1_480, 1_400]);
    expect(result.height).toBe(2_000);
    expect(result.incomplete).toBe(false);
    expect(h.saves[0].height).toBe(2_000);
  });

  it('marks a page that shrinks behind captured rows as partial and preserves those rows', async () => {
    const page = metrics({ scrollHeight: 3_000 });
    const h = harness(page, (y, call) =>
      frameAt({ ...page, scrollHeight: call >= 3 ? 800 : 3_000 }, y),
    );

    const result = await runFullPageSession(page, h.ops);

    expect(h.captures.map(({ state }) => state.scrollY)).toEqual([0, 540]);
    expect(result.height).toBe(1_140);
    expect(h.saves[0].height).toBe(1_140);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/shorter|shrank|changed/i);
  });

  it('detects a page shrinking during the final bottom recheck', async () => {
    const page = metrics();
    const h = harness(page, (y, call) =>
      frameAt({ ...page, scrollHeight: call >= 4 ? 800 : 1_500 }, y),
    );

    const result = await runFullPageSession(page, h.ops);

    expect(h.captures.map(({ state }) => state.scrollY)).toEqual([0, 540, 900]);
    expect(h.ops.scroll).toHaveBeenCalledTimes(4);
    expect(result.height).toBe(1_500);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/shorter|shrank|changed/i);
  });

  it('keeps already saved sections and their captured tail when the page later collapses', async () => {
    const page = metrics({ scrollHeight: 50_000, viewportHeight: 1_000 });
    const h = harness(page, (y, call) =>
      frameAt({ ...page, scrollHeight: call >= 20 ? 8_000 : 50_000 }, y),
    );

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(19);
    expect(h.saves.map(({ y, height }) => ({ y, height }))).toEqual([
      { y: 0, height: 16_000 },
      { y: 16_000, height: 1_200 },
    ]);
    expect(result.height).toBe(17_200);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/shorter|shrank|changed/i);
  });

  it('stops a non-moving scroller with only reached rows and an explicit partial warning', async () => {
    const page = metrics({ scrollHeight: 100_000 });
    const h = harness(page, () => frameAt(page, 0));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(h.ops.scroll).toHaveBeenCalledTimes(2);
    expect(h.stitches[0].height).toBe(600);
    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('stopped scrolling');
  });

  it('does not paint transparent rows when a clipped container reaches its actual bottom', async () => {
    const page = metrics({ scrollHeight: 1_000 });
    const h = harness(page, () => frameAt(page, 0, { atBottom: true }));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('clipped');
  });

  it('rejects a jump over uncaptured content while preserving the continuous prefix', async () => {
    const page = metrics({ scrollHeight: 5_000 });
    const h = harness(page, (y, call) => frameAt(page, call === 2 ? 2_000 : y));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('uncaptured content');
  });

  it('captures beyond 117,812px at normal scale in ordered bounded sections with no gaps', async () => {
    const page = metrics({ scrollHeight: 180_125, viewportHeight: 1_000 });
    const h = harness(page);

    const result = await runFullPageSession(page, h.ops);

    expect(result).toEqual({ width: 1_200, height: 180_125, warnings: [], incomplete: false });
    expect(h.saves).toHaveLength(12);
    let outputY = 0;
    for (const [index, section] of h.saves.entries()) {
      expect(section.y).toBe(outputY);
      expect(section.height).toBeGreaterThan(0);
      expect(section.height).toBeLessThanOrEqual(16_000);
      outputY += section.height;

      // Each source tile contributes real captured rows. Their union must cover
      // every output row, including tiles carried across a section boundary.
      const intervals = h.stitches[index].tiles
        .map((tile) => {
          const source = h.captures.find(({ dataUrl }) => dataUrl === tile.dataUrl)!.state;
          const sourceHeight = Math.min(
            source.viewportHeight,
            source.scrollHeight - source.scrollY,
          );
          return {
            start: Math.max(0, tile.y),
            end: Math.min(section.height, tile.y + sourceHeight),
          };
        })
        .filter(({ start, end }) => end > start)
        .sort((a, b) => a.start - b.start);
      let covered = 0;
      for (const interval of intervals) {
        expect(interval.start).toBeLessThanOrEqual(covered);
        covered = Math.max(covered, interval.end);
      }
      expect(covered).toBe(section.height);
      if (index > 0) expect(h.stitches[index].tiles.some(({ y }) => y < 0)).toBe(true);
    }
    expect(outputY).toBe(page.scrollHeight);
    // Section stitching receives a bounded set, not every previous screenshot.
    expect(Math.max(...h.stitches.map(({ tiles }) => tiles.length))).toBeLessThanOrEqual(20);
  });

  it('uses device pixels consistently when splitting a high-density capture', async () => {
    const page = metrics({ scrollHeight: 30_125, viewportWidth: 1_800, devicePixelRatio: 2 });
    const h = harness(page);

    const result = await runFullPageSession(page, h.ops);

    expect(result.width).toBe(3_600);
    expect(result.height).toBe(60_250);
    expect(
      h.saves.every(({ width, height }) => width === 3_600 && width * height <= 32_000_000),
    ).toBe(true);
    expect(h.saves.reduce((height, section) => height + section.height, 0)).toBe(result.height);
  });
});

describe('full-page session diagnostics and interruption', () => {
  it('deduplicates image timeout and failure warnings without marking reached content partial', async () => {
    const page = metrics();
    const h = harness(page, (y) =>
      frameAt(page, y, { pendingImages: 3, failedImages: 1, timedOut: true }),
    );

    const result = await runFullPageSession(page, h.ops);

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('still loading');
    expect(result.warnings.join(' ')).toContain('failed to load');
    expect(result.incomplete).toBe(false);
    expect(result.height).toBe(page.scrollHeight);
  });

  it('includes image diagnostics discovered during the final settled wait', async () => {
    const page = metrics({ scrollHeight: 300 });
    const h = harness(page, (y, call) => frameAt(page, y, { timedOut: call === 2 }));

    const result = await runFullPageSession(page, h.ops);

    expect(result.warnings.join(' ')).toContain('still loading');
    expect(h.ops.capture).toHaveBeenCalledTimes(1);
  });

  it('preserves the reached prefix when Escape cancels a later scroll wait', async () => {
    const page = metrics();
    const h = harness(page, (y, call) => frameAt(page, y, { cancelled: call === 2 }));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('Escape');
  });

  it('handles Escape during the bottom recheck without taking a duplicate snapshot', async () => {
    const page = metrics({ scrollHeight: 300 });
    const h = harness(page, (y, call) => frameAt(page, y, { cancelled: call === 2 }));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(300);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('Escape');
  });

  it('does not manufacture an empty capture when cancelled before the first screenshot', async () => {
    const page = metrics();
    const h = harness(page, (y) => frameAt(page, y, { cancelled: true }));

    await expect(runFullPageSession(page, h.ops)).rejects.toThrow('before any image');

    expect(h.ops.capture).not.toHaveBeenCalled();
    expect(h.ops.save).not.toHaveBeenCalled();
  });

  it('flushes the last successful tile after a later screenshot fails', async () => {
    const page = metrics();
    const h = harness(page);
    h.ops.capture
      .mockResolvedValueOnce('data:image/png;base64,first')
      .mockRejectedValueOnce(new Error('Tab changed'));

    const result = await runFullPageSession(page, h.ops);

    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings).toContain('Tab changed');
    expect(h.ops.save).toHaveBeenCalledTimes(1);
  });

  it('propagates the original failure if no screenshot has succeeded', async () => {
    const page = metrics();
    const h = harness(page);
    h.ops.capture.mockRejectedValueOnce(new Error('Cannot capture this tab'));

    await expect(runFullPageSession(page, h.ops)).rejects.toThrow('Cannot capture this tab');

    expect(h.ops.save).not.toHaveBeenCalled();
  });

  it.each([
    { viewportWidth: 1_300 },
    { viewportHeight: 500 },
    { devicePixelRatio: 2 },
    { container: { x: 0, y: 0, width: 1_200, height: 600 } },
  ])('preserves earlier content when capture geometry changes: %j', async (change) => {
    const page = metrics();
    const h = harness(page, (y, call) => frameAt(page, y, call === 2 ? change : {}));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('changed during capture');
  });

  it('reports geometry changes during the final bottom recheck', async () => {
    const page = metrics({ scrollHeight: 300 });
    const h = harness(page, (y, call) =>
      frameAt(page, y, call === 2 ? { devicePixelRatio: 2 } : {}),
    );

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(300);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('changed during capture');
  });

  it('stops at the frame safety limit and saves only covered content', async () => {
    const page = metrics({ scrollHeight: 1_000_000 });
    const h = harness(page);

    const result = await runFullPageSession(page, h.ops, { maxFrames: 3 });

    expect(h.ops.capture).toHaveBeenCalledTimes(3);
    expect(result.height).toBe(1_680);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('safety limit');
  });

  it('stops at the elapsed-time safety limit with a preserved section', async () => {
    const page = metrics({ scrollHeight: 1_000_000 });
    const h = harness(page);
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(100);

    const result = await runFullPageSession(page, h.ops, { maxDurationMs: 50 });

    expect(h.ops.capture).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(600);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('safety limit');
  });
});

describe('section saving failures', () => {
  it('does not retry failed storage or claim rows from the failed section', async () => {
    const page = metrics({ scrollHeight: 50_000, viewportHeight: 1_000 });
    const h = harness(page);
    const save = h.ops.save.getMockImplementation()!;
    h.ops.save.mockImplementationOnce(save).mockRejectedValueOnce(new Error('Local storage full'));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.save).toHaveBeenCalledTimes(2);
    expect(h.ops.stitch).toHaveBeenCalledTimes(2);
    expect(h.saves).toHaveLength(1);
    expect(result.height).toBe(16_000);
    expect(result.incomplete).toBe(true);
    expect(result.warnings).toContain('Local storage full');
  });

  it('does not retry an invalid canvas result and preserves already saved sections', async () => {
    const page = metrics({ scrollHeight: 50_000, viewportHeight: 1_000 });
    const h = harness(page);
    const stitch = h.ops.stitch.getMockImplementation()!;
    h.ops.stitch.mockImplementationOnce(stitch).mockResolvedValueOnce('data:');

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.stitch).toHaveBeenCalledTimes(2);
    expect(h.ops.save).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(16_000);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.join(' ')).toContain('could not create');
  });

  it('rejects the result if storage fails before any section can be saved', async () => {
    const page = metrics({ scrollHeight: 50_000, viewportHeight: 1_000 });
    const h = harness(page);
    h.ops.save.mockRejectedValueOnce(new Error('Local storage full'));

    await expect(runFullPageSession(page, h.ops)).rejects.toThrow();

    expect(h.ops.save).toHaveBeenCalledTimes(1);
    expect(h.ops.stitch).toHaveBeenCalledTimes(1);
    expect(h.saves).toHaveLength(0);
  });

  it('preserves prior sections if saving the final short tail fails', async () => {
    const page = metrics({ scrollHeight: 17_000, viewportHeight: 1_000 });
    const h = harness(page);
    const save = h.ops.save.getMockImplementation()!;
    h.ops.save.mockImplementationOnce(save).mockRejectedValueOnce(new Error('Final write failed'));

    const result = await runFullPageSession(page, h.ops);

    expect(h.ops.save).toHaveBeenCalledTimes(2);
    expect(result.height).toBe(16_000);
    expect(result.incomplete).toBe(true);
    expect(result.warnings).toContain('Final write failed');
  });
});

describe('section canvas bounds', () => {
  it.each([0, -1, 1.5, Infinity, NaN, 32_001])('rejects unsupported output width %s', (width) => {
    expect(() => sectionHeightForWidth(width)).toThrow('too wide');
  });

  it.each([1, 1_200, 2_000, 3_600, 16_000, 32_000])(
    'bounds width %i by dimension and area',
    (width) => {
      const height = sectionHeightForWidth(width);
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(16_000);
      expect(width * height).toBeLessThanOrEqual(32_000_000);
    },
  );
});
