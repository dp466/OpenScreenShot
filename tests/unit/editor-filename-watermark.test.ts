import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeEditorExport, editorExportName } from '../../src/editor/useEditor';
import { editorExportErrorMessage } from '../../src/editor/App';
import { getMessage, setUiLanguage } from '../../src/shared/i18n';
import { ExportNameError } from '../../src/shared/export-name';
import type { LastCapture } from '../../src/shared/types';
import { drawWatermark, ensureWatermarkFont } from '../../src/shared/watermark';

vi.mock('../../src/shared/watermark', () => ({
  drawWatermark: vi.fn(),
  ensureWatermarkFont: vi.fn(async () => {}),
}));

function capture(overrides: Partial<LastCapture> = {}): LastCapture {
  return {
    dataUrl: 'data:image/png;base64,raw',
    width: 1200,
    height: 800,
    mode: 'full-page',
    title: 'Original page title',
    capturedAt: 0,
    exportName: 'Rapport été.pdf',
    filenameWatermark: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureWatermarkFont).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUiLanguage('en');
});

describe('editor export names', () => {
  it('preserves a stored extension-looking canonical base without stripping it again', () => {
    expect(editorExportName(capture(), 'Rapport été.pdf')).toBe('Rapport été.pdf');
  });

  it('normalizes a newly edited filename only once and keeps Unicode', () => {
    expect(editorExportName(capture(), '  Résumé final.png.pdf  ')).toBe('Résumé final.png');
  });

  it.each([undefined, false])('leaves an unmarked capture name unchanged (%s)', (flag) => {
    expect(editorExportName(capture({ filenameWatermark: flag }), ' legacy?.png ')).toBe(
      ' legacy?.png ',
    );
  });

  it('does not opt imported files or an empty editor into the naming rules', () => {
    const imported = capture({
      mode: 'import',
      exportName: undefined,
      filenameWatermark: undefined,
    });
    expect(editorExportName(imported, 'file.png')).toBe('file.png');
    expect(editorExportName(null, 'file.png')).toBe('file.png');
  });

  it('retains the flag on an import that originated from a marked history entry', () => {
    expect(editorExportName(capture({ mode: 'import' }), ' new name.webp ')).toBe('new name');
  });

  it.each(['fr', 'en'])(
    'preserves typed errors and displays invalid new and stored names in %s',
    (language) => {
      setUiLanguage(language);
      for (const [source, input, key] of [
        [capture(), 'bad/name', 'exportNameErrorInvalid'],
        [capture({ exportName: 'bad/name' }), 'bad/name', 'exportNameErrorInvalid'],
        [capture(), '   ', 'exportNameErrorEmpty'],
      ] as const) {
        let failure: unknown;
        try {
          editorExportName(source, input);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(ExportNameError);
        expect(editorExportErrorMessage(failure)).toBe(getMessage(key));
      }
    },
  );

  it.each(['fr', 'en'])('keeps non-validation export failures generic in %s', (language) => {
    setUiLanguage(language);
    for (const failure of [
      new Error('Internal canvas failure with a private path'),
      { messageKey: 'exportNameErrorEmpty' },
      'exportNameErrorEmpty',
      undefined,
    ]) {
      expect(editorExportErrorMessage(failure)).toBe(getMessage('editorExportError'));
    }
  });
});

class ExportCanvas {
  width = 1200;
  height = 800;
  context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage: vi.fn(),
  };
  getContext = vi.fn(() => this.context);
}

function controller(canvas: ExportCanvas) {
  return { composeFinal: vi.fn(() => canvas as unknown as HTMLCanvasElement) };
}

describe('editor final watermark composition', () => {
  it('awaits the selected name font before stamping a composed canvas for clipboard or export', async () => {
    const composed = new ExportCanvas();
    const source = controller(composed);
    let fontReady!: () => void;
    vi.mocked(ensureWatermarkFont).mockReturnValueOnce(
      new Promise((resolve) => {
        fontReady = resolve;
      }),
    );
    const pending = composeEditorExport(source, 'Résumé final');
    expect(source.composeFinal).toHaveBeenCalledOnce();
    expect(ensureWatermarkFont).toHaveBeenCalledWith('Résumé final');
    expect(drawWatermark).not.toHaveBeenCalled();
    fontReady();
    expect(await pending).toBe(composed);
    expect(drawWatermark).toHaveBeenCalledExactlyOnceWith(
      composed.context,
      'Résumé final',
      1200,
      800,
    );
  });

  it('finishes all resizing before stamping, so the name uses the exported dimensions', async () => {
    const composed = new ExportCanvas();
    const resized: ExportCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const canvas = new ExportCanvas();
        resized.push(canvas);
        return canvas;
      }),
    });
    const exported = await composeEditorExport(controller(composed), 'Reduced export', 300);
    expect(resized).toHaveLength(2);
    expect(exported).toBe(resized[1]);
    expect(resized[0].context.drawImage).toHaveBeenCalledWith(composed, 0, 0, 600, 400);
    expect(resized[1].context.drawImage).toHaveBeenCalledWith(resized[0], 0, 0, 300, 200);
    expect(composed.getContext).not.toHaveBeenCalled();
    expect(drawWatermark).toHaveBeenCalledExactlyOnceWith(
      resized[1].context,
      'Reduced export',
      300,
      200,
    );
    expect(drawWatermark).toHaveBeenCalledAfter(resized[1].context.drawImage);
  });

  it('leaves ordinary exports free of font loading or added drawing', async () => {
    const composed = new ExportCanvas();
    expect(await composeEditorExport(controller(composed))).toBe(composed);
    expect(composed.getContext).not.toHaveBeenCalled();
    expect(ensureWatermarkFont).not.toHaveBeenCalled();
    expect(drawWatermark).not.toHaveBeenCalled();
  });

  it('fails instead of silently exporting an unmarked canvas when its context is unavailable', async () => {
    const composed = new ExportCanvas();
    composed.getContext.mockReturnValueOnce(null as unknown as typeof composed.context);
    await expect(composeEditorExport(controller(composed), 'Required mark')).rejects.toThrow(
      'Canvas 2D context unavailable',
    );
    expect(drawWatermark).not.toHaveBeenCalled();
  });
});
