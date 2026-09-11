/** A single validated base is shared by the download filename and its watermark. */
export const EXPORT_NAME_MAX_LENGTH = 120;
export const EXPORT_NAME_SUGGESTION_MAX_LENGTH = 80;

export type ExportNameErrorCode = 'empty' | 'invalid' | 'too-long' | 'reserved';

const ERROR_MESSAGE_KEYS = {
  empty: 'exportNameErrorEmpty',
  invalid: 'exportNameErrorInvalid',
  'too-long': 'exportNameErrorTooLong',
  reserved: 'exportNameErrorReserved',
} as const;

export class ExportNameError extends Error {
  readonly messageKey: (typeof ERROR_MESSAGE_KEYS)[ExportNameErrorCode];

  constructor(readonly code: ExportNameErrorCode) {
    super(ERROR_MESSAGE_KEYS[code]);
    this.name = 'ExportNameError';
    this.messageKey = ERROR_MESSAGE_KEYS[code];
  }
}

const KNOWN_EXTENSION = /\.(?:pdf|png|jpe?g|webp)$/i;
// Unicode properties also reject malformed surrogate code units. Line separators
// are not Cc characters but still cannot be part of a single-line watermark.
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*]|\p{Cc}|\p{Cs}|\u2028|\u2029/u;
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;

function isReservedDevice(value: string): boolean {
  // Windows reserves device names even with extensions or spaces before a dot.
  return RESERVED_DEVICE.test(value.split('.', 1)[0].trim());
}

/** Check an already chosen base without changing its filename or watermark. */
export function validateExportName(value: string): string {
  if (FORBIDDEN_CHARACTERS.test(value)) throw new ExportNameError('invalid');
  if (!value.trim()) throw new ExportNameError('empty');
  if (value !== value.trim() || /[.]$/.test(value)) throw new ExportNameError('invalid');
  if ([...value].length > EXPORT_NAME_MAX_LENGTH) throw new ExportNameError('too-long');
  if (isReservedDevice(value)) throw new ExportNameError('reserved');
  return value;
}

/**
 * Normalize only the user's outer whitespace, Unicode composition, and one
 * optional export extension. All other unsafe input receives an explicit error.
 * Store the returned base and reuse it verbatim; do not normalize it a second
 * time, because the user can intentionally name a capture "report.pdf.png".
 */
export function normalizeExportName(input: string): string {
  if (FORBIDDEN_CHARACTERS.test(input)) throw new ExportNameError('invalid');
  const value = input.normalize('NFC').trim().replace(KNOWN_EXTENSION, '');
  return validateExportName(value);
}

function safeSuggestion(input: string): string {
  const withoutExtension = input.normalize('NFC').trim().replace(KNOWN_EXTENSION, '');
  const sanitized = [...withoutExtension]
    .map((character) => (FORBIDDEN_CHARACTERS.test(character) ? '-' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .replace(/^[. -]+|[. -]+$/g, '');
  const unreserved = isReservedDevice(sanitized) ? `capture-${sanitized}` : sanitized;
  return [...unreserved]
    .slice(0, EXPORT_NAME_SUGGESTION_MAX_LENGTH)
    .join('')
    .replace(/[. ]+$/g, '');
}

/** Suggestions can clean a page title; submitted user input is never sanitized. */
export function suggestExportName(title: string, fallback = 'capture-ecran'): string {
  return safeSuggestion(title) || safeSuggestion(fallback) || 'capture-ecran';
}
