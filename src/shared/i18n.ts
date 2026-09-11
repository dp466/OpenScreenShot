import englishMessages from '../../public/_locales/en/messages.json';
import frenchMessages from '../../public/_locales/fr/messages.json';

export type UiLanguage = 'fr' | 'en' | 'auto';

export interface LocalizedMessage {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const SETTINGS_KEY = 'openscreenshot:settings';
const catalog = (messages: Record<string, LocalizedMessage>) =>
  new Map(Object.entries(messages).map(([key, value]) => [key.toLowerCase(), value]));
const catalogs = { en: catalog(englishMessages), fr: catalog(frenchMessages) };

// Before the entry point loads the saved preference, retain native Chrome
// behavior. UI modules are imported only after initializeI18n() finishes.
let language: UiLanguage | null = null;

export function normalizeLanguage(value: unknown): UiLanguage {
  return value === 'en' || value === 'auto' || value === 'fr' ? value : 'fr';
}

function browserLanguage(): string {
  try {
    const locale = globalThis.chrome?.i18n?.getUILanguage?.();
    if (locale) return locale.replaceAll('_', '-');
  } catch {
    // A browser preview or extension teardown may not expose this API.
  }
  return globalThis.navigator?.language || 'en';
}

/** The resolved display language, including a browser locale in automatic mode. */
export function getUiLanguage(): string {
  return language === null || language === 'auto' ? browserLanguage() : language;
}

/** Update this context; settings persistence remains the caller's responsibility. */
export function setUiLanguage(value: unknown): UiLanguage {
  language = normalizeLanguage(value);
  if (typeof document !== 'undefined') document.documentElement.lang = getUiLanguage();
  return language;
}

/** Read only local settings. A transient read failure can be retried on the next call. */
export async function initializeI18n(): Promise<void> {
  let storedLanguage: unknown;
  try {
    const stored = await globalThis.chrome?.storage?.local?.get(SETTINGS_KEY);
    const settings: unknown = stored?.[SETTINGS_KEY];
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      storedLanguage = (settings as Record<string, unknown>).language;
    }
  } catch {
    // The French default keeps all menus usable when local storage is unavailable.
  }
  setUiLanguage(storedLanguage);
}

/**
 * Chrome message syntax: named placeholders are case-insensitive, $1–$9
 * insert substitutions, and $$ is a literal dollar sign. Substitutions are
 * inserted once, so page titles or filenames containing $ never become tokens.
 */
export function formatMessage(entry: LocalizedMessage, substitutions?: string | string[]): string {
  const values = typeof substitutions === 'string' ? [substitutions] : (substitutions ?? []);
  const placeholders = new Map(
    Object.entries(entry.placeholders ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const insertValues = (content: string) =>
    content.replace(/\$\$|\$([1-9])/g, (token, index: string | undefined) =>
      token === '$$' ? '$' : (values[Number(index) - 1] ?? ''),
    );
  return entry.message.replace(
    /\$\$|\$([a-z0-9_@]+)\$|\$([1-9])/gi,
    (token, name: string | undefined, index: string | undefined) => {
      if (token === '$$') return '$';
      if (index) return values[Number(index) - 1] ?? '';
      const placeholder = placeholders.get((name ?? '').toLowerCase());
      return placeholder ? insertValues(placeholder.content) : token;
    },
  );
}

function nativeMessage(id: string, substitutions?: string | string[]): string {
  try {
    return globalThis.chrome?.i18n?.getMessage?.(id, substitutions) || '';
  } catch {
    return '';
  }
}

/** Same call shape as chrome.i18n.getMessage, with a locally chosen language. */
export function getMessage(id: string, substitutions?: string | string[]): string {
  const key = id.toLowerCase();
  if (language === null || language === 'auto') {
    const native = nativeMessage(id, substitutions);
    if (native) return native;
  } else if (key === '@@ui_locale') {
    return language;
  }
  const resolved = getUiLanguage().toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const entry = catalogs[resolved].get(key) ?? catalogs.en.get(key);
  return entry ? formatMessage(entry, substitutions) : nativeMessage(id, substitutions);
}
