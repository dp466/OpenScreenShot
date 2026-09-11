import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import {
  DEFAULT_FULL_PAGE_SETTINGS,
  IMAGE_WAIT_TIMEOUT_MAX_MS,
  IMAGE_WAIT_TIMEOUT_MIN_MS,
  normalizeFullPageSettings,
  SCROLL_DELAY_MAX_MS,
  SCROLL_DELAY_MIN_MS,
} from '../../src/shared/capture-settings';
import { getSettings, setSettings } from '../../src/shared/storage';

afterEach(() => vi.unstubAllGlobals());

describe('full-page capture preferences', () => {
  it('gives existing installations safe defaults without changing their initial countdown', () => {
    expect(normalizeFullPageSettings({ captureDelay: 5 })).toEqual({
      scrollDelayMs: 1500,
      waitForImages: true,
      imageWaitTimeoutMs: 10000,
      longPageOutput: 'pdf',
    });
    expect(normalizeFullPageSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_FULL_PAGE_SETTINGS);
  });

  it('preserves supported user choices including disabling the additional image wait', () => {
    const chosen = {
      scrollDelayMs: 2500,
      waitForImages: false,
      imageWaitTimeoutMs: 18000,
      longPageOutput: 'png' as const,
    };
    expect(normalizeFullPageSettings(chosen)).toEqual(chosen);
    expect(normalizeFullPageSettings(normalizeFullPageSettings(chosen))).toEqual(chosen);
  });

  it('clamps timing values so a corrupted preference cannot cause an unlimited wait', () => {
    expect(normalizeFullPageSettings({ scrollDelayMs: -50, imageWaitTimeoutMs: 0 })).toMatchObject({
      scrollDelayMs: SCROLL_DELAY_MIN_MS,
      imageWaitTimeoutMs: IMAGE_WAIT_TIMEOUT_MIN_MS,
    });
    expect(
      normalizeFullPageSettings({ scrollDelayMs: 9e9, imageWaitTimeoutMs: 9e9 }),
    ).toMatchObject({
      scrollDelayMs: SCROLL_DELAY_MAX_MS,
      imageWaitTimeoutMs: IMAGE_WAIT_TIMEOUT_MAX_MS,
    });
  });

  it.each([NaN, Infinity, -Infinity, null, undefined, '2000', {}, true])(
    'replaces non-finite or non-numeric timing values (%s) with defaults',
    (value) => {
      expect(
        normalizeFullPageSettings({
          scrollDelayMs: value,
          imageWaitTimeoutMs: value,
        }),
      ).toEqual(DEFAULT_FULL_PAGE_SETTINGS);
    },
  );

  it.each([undefined, null, false, 'settings', [], 123])(
    'handles malformed settings blobs (%s)',
    (value) => expect(normalizeFullPageSettings(value)).toEqual(DEFAULT_FULL_PAGE_SETTINGS),
  );

  it('rejects truthy boolean strings and unsupported output formats', () => {
    expect(normalizeFullPageSettings({ waitForImages: 'false', longPageOutput: 'cloud' })).toEqual(
      DEFAULT_FULL_PAGE_SETTINGS,
    );
  });

  it('rounds fractional milliseconds and does not modify the stored input', () => {
    const input = Object.freeze({ scrollDelayMs: 1750.6, imageWaitTimeoutMs: 9500.2 });
    expect(normalizeFullPageSettings(input)).toMatchObject({
      scrollDelayMs: 1751,
      imageWaitTimeoutMs: 9500,
    });
    expect(input.scrollDelayMs).toBe(1750.6);
  });

  it('reads older local settings without changing unrelated user preferences', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: { theme: 'dark', captureDelay: 5 } })),
        },
      },
    });
    expect(await getSettings()).toMatchObject({
      ...DEFAULT_FULL_PAGE_SETTINGS,
      theme: 'dark',
      captureDelay: 5,
    });
  });

  it('persists normalized preferences to local storage and retains the other controls', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({
            [key]: {
              scrollDelayMs: 2000,
              captureDelay: 3,
              longPageOutput: 'png',
            },
          })),
          set: write,
        },
      },
    });
    const result = await setSettings({ imageWaitTimeoutMs: 999999, waitForImages: false });
    expect(result).toMatchObject({
      scrollDelayMs: 2000,
      captureDelay: 3,
      longPageOutput: 'png',
      imageWaitTimeoutMs: IMAGE_WAIT_TIMEOUT_MAX_MS,
      waitForImages: false,
    });
    expect(write).toHaveBeenCalledExactlyOnceWith({ 'openscreenshot:settings': result });
  });
});
