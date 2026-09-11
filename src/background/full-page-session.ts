import type { Metrics, TileSpec } from '../shared/types';

export interface ScrollFrame extends Metrics {
  scrollY: number;
  pendingImages: number;
  failedImages: number;
  timedOut: boolean;
  atBottom: boolean;
  cancelled: boolean;
}

export interface CaptureSessionOps {
  scroll(y: number): Promise<ScrollFrame>;
  capture(): Promise<string>;
  hideFixed(): Promise<void>;
  progress(covered: number, total: number): Promise<void>;
  stitch(tiles: TileSpec[], width: number, height: number): Promise<string>;
  save(dataUrl: string, width: number, height: number, y: number): Promise<void>;
}

/** A bounded canvas keeps the output independent of the page's total height. */
export function sectionHeightForWidth(width: number): number {
  if (!Number.isSafeInteger(width) || width <= 0 || width > 32_000) {
    throw new Error('The capture is too wide. Make the browser window narrower and retry.');
  }
  return Math.min(16_000, Math.floor(32_000_000 / width));
}

/**
 * Actual visible rows, rather than requested scroll positions, define coverage.
 * Only one section and its overlapping viewport tiles remain in memory.
 * Errors after a successful tile produce an explicitly partial local capture.
 */
export async function runFullPageSession(
  initial: Metrics,
  ops: CaptureSessionOps,
  limits: { maxFrames?: number; maxDurationMs?: number } = {},
): Promise<{ width: number; height: number; warnings: string[]; incomplete: boolean }> {
  const dpr = initial.devicePixelRatio;
  const width = Math.round((initial.container?.width ?? initial.viewportWidth) * dpr);
  const sectionHeight = sectionHeightForWidth(width);
  const warnings = new Set<string>();
  const started = Date.now();
  const maxFrames = limits.maxFrames ?? 2_000;
  const maxDurationMs = limits.maxDurationMs ?? 30 * 60_000;
  let incomplete = false;
  let covered = 0;
  let saved = 0;
  let origin = 0;
  let frames = 0;
  let tiles: (TileSpec & { height: number })[] = [];
  let canSave = true;
  let previousY = -Infinity;

  const flush = async (height: number) => {
    if (height <= 0) return;
    try {
      const dataUrl = await ops.stitch(
        tiles.map(({ dataUrl, y }) => ({ dataUrl, y: y - saved })),
        width,
        height,
      );
      if (!dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error('The browser could not create this image section.');
      }
      await ops.save(dataUrl, width, height, saved);
      saved += height;
      tiles = tiles.filter((tile) => tile.y + tile.height > saved);
    } catch (error) {
      canSave = false;
      throw error;
    }
  };

  const sameGeometry = (state: ScrollFrame) => {
    if (
      state.devicePixelRatio !== dpr ||
      state.viewportWidth !== initial.viewportWidth ||
      state.viewportHeight !== initial.viewportHeight ||
      !!state.container !== !!initial.container
    )
      return false;
    if (!state.container || !initial.container) return true;
    return (['x', 'y', 'width', 'height'] as const).every(
      (key) => Math.abs(state.container![key] - initial.container![key]) < 0.5,
    );
  };
  const imageWarnings = (state: ScrollFrame) => {
    if (state.timedOut)
      warnings.add(
        'Some visible images were still loading when their wait expired. Increase the image wait and retry if needed.',
      );
    if (state.failedImages > 0) warnings.add('Some visible images failed to load on the website.');
  };

  const checkShrinkingPage = (state: ScrollFrame) => {
    if (Math.round(state.scrollHeight * dpr) - origin < covered - 1) {
      incomplete = true;
      warnings.add(
        'The page became shorter during capture. Saved sections reflect the content visible before that change; retry once the page has settled.',
      );
    }
  };

  try {
    let state = await ops.scroll(0);
    if (state.scrollY > 1) {
      origin = Math.round(state.scrollY * dpr);
      warnings.add(
        'The top of this scroll container is outside the visible browser area. Only its visible content was captured.',
      );
      incomplete = true;
    }
    while (true) {
      if (state.cancelled) {
        warnings.add('Capture stopped with Escape. Saved content is preserved.');
        incomplete = true;
        break;
      }
      if (!sameGeometry(state))
        throw new Error(
          'The browser size, zoom, or scroll container changed during capture. Retry with a stable layout.',
        );
      imageWarnings(state);
      checkShrinkingPage(state);
      const y = Math.round(state.scrollY * dpr) - origin;
      const end =
        Math.round(Math.min(state.scrollY + state.viewportHeight, state.scrollHeight) * dpr) -
        origin;
      if (y > covered + 1)
        throw new Error(
          'The page jumped past uncaptured content. Saved sections stop before that gap.',
        );
      if (end <= covered || (frames > 0 && state.scrollY <= previousY + 0.5)) {
        if (!state.atBottom) {
          incomplete = true;
          warnings.add(
            'The page stopped scrolling before its reported end. Only the content reached is included.',
          );
        }
        break;
      }
      const dataUrl = await ops.capture();
      tiles.push({ dataUrl, y, height: end - y });
      covered = end;
      previousY = state.scrollY;
      frames++;
      while (covered - saved >= sectionHeight) await flush(sectionHeight);
      await ops.progress(covered, Math.max(covered, Math.round(state.scrollHeight * dpr) - origin));

      // One settled recheck allows bottom-triggered lazy content to extend the
      // page, without taking a second screenshot of the same clamped position.
      if (state.atBottom) {
        const recheck = await ops.scroll(state.scrollY);
        if (!sameGeometry(recheck)) {
          throw new Error(
            'The browser size, zoom, or scroll container changed during capture. Retry with a stable layout.',
          );
        }
        imageWarnings(recheck);
        checkShrinkingPage(recheck);
        if (recheck.cancelled) {
          state = recheck;
          continue;
        }
        if (recheck.atBottom) {
          if (Math.round(recheck.scrollHeight * dpr) - origin > covered + 1) {
            warnings.add(
              'The end of this scroll container is clipped outside the visible browser area.',
            );
            incomplete = true;
          }
          break;
        }
        state = recheck;
      }
      if (frames >= maxFrames || Date.now() - started >= maxDurationMs) {
        incomplete = true;
        warnings.add(
          'Capture stopped at its safety limit (2,000 views or 30 minutes). This may be an infinite page; earlier sections are preserved.',
        );
        break;
      }
      if (frames === 1) await ops.hideFixed();
      state = await ops.scroll(state.scrollY + state.viewportHeight * 0.9);
    }
  } catch (error) {
    if (covered === 0) throw error;
    incomplete = true;
    warnings.add(
      error instanceof Error
        ? error.message
        : 'Capture was interrupted. Earlier sections are preserved.',
    );
  }
  if (canSave && covered > saved) {
    try {
      await flush(covered - saved);
    } catch (error) {
      if (saved === 0) throw error;
      incomplete = true;
      warnings.add(
        error instanceof Error ? error.message : 'The final section could not be saved.',
      );
    }
  }
  if (saved === 0) throw new Error('Capture stopped before any image could be saved.');
  return { width, height: saved, warnings: [...warnings], incomplete };
}
