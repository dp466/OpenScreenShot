import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import frenchMessages from '../../public/_locales/fr/messages.json';
import englishMessages from '../../public/_locales/en/messages.json';

const SETTINGS_KEY = 'openscreenshot:settings';

function chromeStub(language: unknown = 'fr', browserLocale = 'en-US') {
  const get = vi.fn().mockResolvedValue({ [SETTINGS_KEY]: { language } });
  const getMessage = vi.fn((id: string) => (id === 'missingKey' ? '' : `native:${id}`));
  vi.stubGlobal('chrome', {
    storage: { local: { get } },
    i18n: { getMessage, getUILanguage: () => browserLocale },
  });
  return { get, getMessage };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('document', { documentElement: { lang: 'en' } });
  vi.stubGlobal('navigator', { language: 'en-US' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local UI language preference', () => {
  it('keeps native Chrome behavior before initialization', async () => {
    const native = chromeStub('fr');
    const i18n = await import('../../src/shared/i18n');
    expect(i18n.getMessage('settingsTitle')).toBe('native:settingsTitle');
    expect(native.get).not.toHaveBeenCalled();
  });

  it('uses stored French even when Chrome is English', async () => {
    const native = chromeStub('fr', 'en-US');
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getMessage('settingsTitle')).toBe(frenchMessages.settingsTitle.message);
    expect(i18n.getUiLanguage()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(native.getMessage).not.toHaveBeenCalled();
    expect(native.get).toHaveBeenCalledWith(SETTINGS_KEY);
  });

  it('supports English independently of a French browser', async () => {
    chromeStub('en', 'fr-CA');
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getMessage('settingsTitle')).toBe(englishMessages.settingsTitle.message);
    expect(i18n.getUiLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('uses native messages and the browser locale in automatic mode', async () => {
    chromeStub('auto', 'fr-CA');
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getMessage('settingsTitle')).toBe('native:settingsTitle');
    expect(i18n.getUiLanguage()).toBe('fr-CA');
    expect(document.documentElement.lang).toBe('fr-CA');
  });

  it.each([undefined, null, false, 1, [], {}, 'de', 'FR'])(
    'defaults missing or invalid preferences to French: %j',
    async (invalid) => {
      chromeStub(invalid);
      const i18n = await import('../../src/shared/i18n');
      await i18n.initializeI18n();
      expect(i18n.getUiLanguage()).toBe('fr');
      expect(i18n.normalizeLanguage(invalid)).toBe('fr');
    },
  );

  it('upgrades old settings without writing over existing settings', async () => {
    const stub = chromeStub();
    stub.get.mockResolvedValue({ [SETTINGS_KEY]: { captureDelay: 4 } });
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getUiLanguage()).toBe('fr');
    expect(stub.get).toHaveBeenCalledTimes(1);
  });

  it('defaults a new installation with no settings to French', async () => {
    const stub = chromeStub();
    stub.get.mockResolvedValue({});
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getUiLanguage()).toBe('fr');
  });

  it('can initialize again after a failed local storage read', async () => {
    const stub = chromeStub('en');
    stub.get.mockRejectedValueOnce(new Error('storage temporarily unavailable'));
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getUiLanguage()).toBe('fr');
    await i18n.initializeI18n();
    expect(i18n.getUiLanguage()).toBe('en');
  });

  it('can render without Chrome APIs, using local dictionaries only', async () => {
    vi.stubGlobal('chrome', undefined);
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getMessage('settingsTitle')).toBe(frenchMessages.settingsTitle.message);
    expect(i18n.getMessage('missingKey')).toBe('');
  });

  it('updates worker contexts synchronously without requiring a document', async () => {
    chromeStub('fr');
    vi.stubGlobal('document', undefined);
    const i18n = await import('../../src/shared/i18n');
    i18n.setUiLanguage('en');
    expect(i18n.getMessage('settingsTitle')).toBe(englishMessages.settingsTitle.message);
    expect(i18n.getMessage('@@ui_locale')).toBe('en');
  });

  it('looks up message names without case sensitivity and keeps unknown keys empty', async () => {
    chromeStub('fr');
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    expect(i18n.getMessage('SETTINGSTITLE')).toBe(frenchMessages.settingsTitle.message);
    expect(i18n.getMessage('missingKey')).toBe('');
  });
});

describe('Chrome-compatible local message formatting', () => {
  it('fills real multi-value catalog placeholders', async () => {
    chromeStub('fr');
    const i18n = await import('../../src/shared/i18n');
    await i18n.initializeI18n();
    const entry = Object.values(frenchMessages).find(
      (value) =>
        'placeholders' in value && 'total' in value.placeholders && 'index' in value.placeholders,
    );
    expect(entry).toBeDefined();
    const formatted = i18n.formatMessage(entry!, ['Rectangle', '2', '4']);
    expect(formatted).toContain('Rectangle');
    expect(formatted).toContain('2');
    expect(formatted).toContain('4');
    expect(formatted).not.toMatch(/\$[A-Z_]+\$/);
  });

  it('handles mixed-case named placeholders, embedded content, and missing arguments', async () => {
    const { formatMessage } = await import('../../src/shared/i18n');
    expect(
      formatMessage(
        {
          message: '$User$ — $COUNT$ — $missing$ — $3',
          placeholders: {
            user: { content: '$1' },
            count: { content: 'item $2' },
            missing: { content: '$9' },
          },
        },
        ['Dilan', '2'],
      ),
    ).toBe('Dilan — item 2 —  — ');
  });

  it('preserves dollar signs in substituted page titles and escapes catalog dollars', async () => {
    const { formatMessage } = await import('../../src/shared/i18n');
    expect(
      formatMessage(
        {
          message: 'Cost $$5: $NAME$; $1',
          placeholders: { name: { content: '$1' } },
        },
        '$2 / $$ / $NAME$',
      ),
    ).toBe('Cost $5: $2 / $$ / $NAME$; $2 / $$ / $NAME$');
  });
});
