import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, setSettings } from '../../src/shared/storage';
import type { Settings, UiLanguagePreference } from '../../src/shared/types';

const KEY = 'openscreenshot:settings';

function localSettings(initial?: Record<string, unknown>) {
  let data: Record<string, unknown> = initial ? { [KEY]: initial } : {};
  const set = vi.fn(async (patch: Record<string, unknown>) => {
    data = { ...data, ...patch };
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set,
      },
    },
  });
  return { set };
}

afterEach(() => vi.unstubAllGlobals());

describe('local interface language preference', () => {
  it('starts in French on new installs and retains older capture preferences on upgrade', async () => {
    localSettings();
    expect((await getSettings()).language).toBe('fr');

    localSettings({ theme: 'dark', scrollDelayMs: 2200, waitForImages: false });
    expect(await getSettings()).toMatchObject({
      language: 'fr',
      theme: 'dark',
      scrollDelayMs: 2200,
      waitForImages: false,
    });
  });

  it.each<UiLanguagePreference>(['fr', 'en', 'auto'])(
    'persists %s locally and preserves it through a later capture-setting change',
    async (language) => {
      const { set } = localSettings({ scrollDelayMs: 2500, longPageOutput: 'png' });
      const result = await setSettings({ language });
      expect(set).toHaveBeenLastCalledWith({ [KEY]: result });
      expect(await getSettings()).toMatchObject({
        language,
        scrollDelayMs: 2500,
        longPageOutput: 'png',
      });

      await setSettings({ imageWaitTimeoutMs: 15000 });
      expect(await getSettings()).toMatchObject({ language, imageWaitTimeoutMs: 15000 });
    },
  );

  it.each([null, false, 123, 'FR', 'fr-CA', 'unsupported', {}])(
    'recovers a malformed saved language (%s) without overwriting unrelated values',
    async (language) => {
      localSettings({ language, captureDelay: 3 });
      expect(await getSettings()).toMatchObject({ language: 'fr', captureDelay: 3 });
    },
  );

  it('normalizes invalid incoming settings before writing them', async () => {
    const { set } = localSettings({ language: 'en' });
    const result = await setSettings({ language: 'invalid' } as unknown as Partial<Settings>);
    expect(result.language).toBe('fr');
    expect(set).toHaveBeenLastCalledWith({ [KEY]: result });
  });
});
