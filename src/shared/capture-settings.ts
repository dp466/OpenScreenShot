/** Full-page capture preferences, validated before either the UI or worker uses them. */
export interface FullPageCaptureSettings {
  /** Minimum pause after each scroll, before checking images and capturing. */
  scrollDelayMs: number;
  /** Wait for visible images that are still loading after the scroll pause. */
  waitForImages: boolean;
  /** Maximum additional image-loading wait per captured viewport. */
  imageWaitTimeoutMs: number;
  /** Preferred local export when a page needs several image sections. */
  longPageOutput: 'pdf' | 'png';
}

export const SCROLL_DELAY_MIN_MS = 500;
export const SCROLL_DELAY_MAX_MS = 10_000;
export const IMAGE_WAIT_TIMEOUT_MIN_MS = 1_000;
export const IMAGE_WAIT_TIMEOUT_MAX_MS = 30_000;

export const DEFAULT_FULL_PAGE_SETTINGS: FullPageCaptureSettings = {
  scrollDelayMs: 1_500,
  waitForImages: true,
  imageWaitTimeoutMs: 10_000,
  longPageOutput: 'pdf',
};

function milliseconds(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Missing/new preferences and corrupt stored values cannot bypass capture time bounds. */
export function normalizeFullPageSettings(input: unknown): FullPageCaptureSettings {
  const value =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    scrollDelayMs: milliseconds(
      value.scrollDelayMs,
      DEFAULT_FULL_PAGE_SETTINGS.scrollDelayMs,
      SCROLL_DELAY_MIN_MS,
      SCROLL_DELAY_MAX_MS,
    ),
    waitForImages:
      typeof value.waitForImages === 'boolean'
        ? value.waitForImages
        : DEFAULT_FULL_PAGE_SETTINGS.waitForImages,
    imageWaitTimeoutMs: milliseconds(
      value.imageWaitTimeoutMs,
      DEFAULT_FULL_PAGE_SETTINGS.imageWaitTimeoutMs,
      IMAGE_WAIT_TIMEOUT_MIN_MS,
      IMAGE_WAIT_TIMEOUT_MAX_MS,
    ),
    longPageOutput: value.longPageOutput === 'png' ? 'png' : 'pdf',
  };
}
