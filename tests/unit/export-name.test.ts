import { describe, expect, it } from 'vitest';
import {
  EXPORT_NAME_MAX_LENGTH,
  EXPORT_NAME_SUGGESTION_MAX_LENGTH,
  ExportNameError,
  normalizeExportName,
  suggestExportName,
  validateExportName,
  type ExportNameErrorCode,
} from '../../src/shared/export-name';

function expectNameError(input: string, code: ExportNameErrorCode, messageKey: string) {
  try {
    normalizeExportName(input);
    expect.fail(`Expected ${JSON.stringify(input)} to be rejected`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExportNameError);
    expect(error).toMatchObject({ code, messageKey });
  }
}

describe('chosen export names', () => {
  it('keeps one canonical filename and watermark with French accents and punctuation', () => {
    expect(normalizeExportName('  Étude d’été – façade n° 42.PDF  ')).toBe(
      'Étude d’été – façade n° 42',
    );
    expect(normalizeExportName('Cafe\u0301')).toBe('Café');
  });

  it.each(['pdf', 'PNG', 'jpg', 'JPEG', 'wEbP'])(
    'removes a single optional .%s extension',
    (extension) => expect(normalizeExportName(`Rapport.${extension}`)).toBe('Rapport'),
  );

  it('preserves meaningful dots and unknown extensions', () => {
    expect(normalizeExportName('Rapport.v2.final')).toBe('Rapport.v2.final');
    expect(normalizeExportName('Rapport.pdf.png')).toBe('Rapport.pdf');
  });

  it.each(['', '   ', '.pdf', ' .PNG '])('rejects an empty base (%s)', (input) => {
    expectNameError(input, 'empty', 'exportNameErrorEmpty');
  });

  it.each([
    '../Rapport',
    'dossier/rapport',
    'dossier\\rapport',
    'Rapport: hiver',
    'Rapport*',
    'Rapport?',
    'Rapport"',
    '<Rapport>',
    'Rapport|copie',
    'Rapport\u0000',
    'Rapport\u007f',
    'Rapport\u0085',
    '\nRapport',
    'Rapport\r\n',
    'Rapport\t',
    'Rapport\u2028hiver',
    'Rapport\u2029hiver',
    'Rapport\ud800',
    'Rapport.',
    'Rapport..pdf',
    'Rapport .pdf',
    '.',
    '..',
  ])('rejects unsafe characters or endings without silently changing them (%j)', (input) => {
    expectNameError(input, 'invalid', 'exportNameErrorInvalid');
  });

  it('limits Unicode code points without splitting supplementary characters', () => {
    expect(normalizeExportName('📷'.repeat(EXPORT_NAME_MAX_LENGTH))).toBe(
      '📷'.repeat(EXPORT_NAME_MAX_LENGTH),
    );
    expectNameError('é'.repeat(EXPORT_NAME_MAX_LENGTH + 1), 'too-long', 'exportNameErrorTooLong');
    expectNameError('📷'.repeat(EXPORT_NAME_MAX_LENGTH + 1), 'too-long', 'exportNameErrorTooLong');
  });

  it.each([
    'CON',
    'aux.pdf',
    'NUL',
    'prn',
    'COM1',
    'com9.txt',
    'LPT1',
    'Lpt9.PNG',
    'COM¹',
    'LPT²',
    'con .txt',
    'CONIN$',
    'CONOUT$',
  ])('rejects Windows device names on every platform (%s)', (input) => {
    expectNameError(input, 'reserved', 'exportNameErrorReserved');
  });

  it.each(['Conclusions', 'auxiliaire', 'COM10', 'LPT0'])(
    'permits ordinary words (%s)',
    (input) => {
      expect(normalizeExportName(input)).toBe(input);
    },
  );
});

describe('validation of stored canonical bases', () => {
  it('retains extension-like suffixes and Unicode exactly as stored', () => {
    expect(validateExportName('Rapport.pdf')).toBe('Rapport.pdf');
    expect(validateExportName(normalizeExportName('Rapport.pdf.png'))).toBe('Rapport.pdf');
    expect(validateExportName('Cafe\u0301')).toBe('Cafe\u0301');
  });

  it.each([' title', 'title ', 'title.', '\ntitle', 'title/part', 'CON', 'a'.repeat(121)])(
    'rejects invalid canonical data instead of silently cleaning it (%j)',
    (value) => expect(() => validateExportName(value)).toThrow(ExportNameError),
  );
});

describe('suggested export names', () => {
  it('offers a safe readable title and retains Unicode letters', () => {
    expect(suggestExportName('  Étude: façade / été?  ')).toBe('Étude- façade - été');
    expect(suggestExportName('Bilan\nannuel.pdf')).toBe('Bilan-annuel');
    expect(suggestExportName('Cafe\u0301')).toBe('Café');
  });

  it('makes reserved titles usable without asking the user to fix the suggestion', () => {
    expect(suggestExportName('CON.pdf')).toBe('capture-CON');
    expect(normalizeExportName(suggestExportName('AUX.notes'))).toBe('capture-AUX.notes');
  });

  it('bounds suggestions by code point count', () => {
    const title = '📷'.repeat(100);
    expect(suggestExportName(title)).toBe('📷'.repeat(EXPORT_NAME_SUGGESTION_MAX_LENGTH));
    expect(normalizeExportName(suggestExportName(title))).toBe(suggestExportName(title));
  });

  it.each(['', '   ', '...', '/\\:*?"<>|', '.pdf'])('has a safe fallback for %j', (title) => {
    expect(suggestExportName(title)).toBe('capture-ecran');
    expect(suggestExportName(title, 'Capture d’écran')).toBe('Capture d’écran');
  });

  it('validates even caller-provided fallback text', () => {
    expect(suggestExportName('', 'CON')).toBe('capture-CON');
    expect(suggestExportName('', '///')).toBe('capture-ecran');
  });
});
