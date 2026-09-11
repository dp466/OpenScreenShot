import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawWatermark, ensureWatermarkFont } from '../../src/shared/watermark';

interface TextCall {
  text: string;
  left: number;
  right: number;
  fontSize: number;
}

/** Font-dependent measurements catch layouts that measure before shrinking. */
class WatermarkContext {
  font = '23px serif';
  fillStyle = '#123456';
  globalAlpha = 0.37;
  globalCompositeOperation = 'multiply';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  shadowColor = '#abcdef';
  shadowBlur = 4;
  shadowOffsetX = 3;
  shadowOffsetY = 2;
  textCalls: TextCall[] = [];
  rectCalls: { x: number; y: number; width: number; height: number }[] = [];
  saved = 0;
  restored = 0;
  private states: Record<string, unknown>[] = [];

  get fontSize(): number {
    return Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10);
  }

  save(): void {
    this.saved++;
    this.states.push({
      font: this.font,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY,
    });
  }

  restore(): void {
    this.restored++;
    Object.assign(this, this.states.pop());
  }

  setTransform(): void {}

  measureText(text: string) {
    const width = Array.from(text).reduce((sum, character) => {
      const em = /\p{Mark}/u.test(character)
        ? 0
        : /\s/u.test(character)
          ? 0.32
          : /[\u3000-\u9fff]|\p{Extended_Pictographic}/u.test(character)
            ? 1
            : 0.62;
      return sum + em * this.fontSize;
    }, 0);
    const alignOffset =
      this.textAlign === 'right' ? width : this.textAlign === 'center' ? width / 2 : 0;
    return {
      width,
      actualBoundingBoxLeft: alignOffset + this.fontSize * 0.02,
      actualBoundingBoxRight: width - alignOffset + this.fontSize * 0.03,
      actualBoundingBoxAscent: this.fontSize * 0.84,
      actualBoundingBoxDescent: this.fontSize * 0.22,
      fontBoundingBoxAscent: this.fontSize * 0.9,
      fontBoundingBoxDescent: this.fontSize * 0.25,
    };
  }

  fillText(text: string, x: number): void {
    const metrics = this.measureText(text);
    this.textCalls.push({
      text,
      left: x - metrics.actualBoundingBoxLeft,
      right: x + metrics.actualBoundingBoxRight,
      fontSize: this.fontSize,
    });
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.rectCalls.push({ x, y, width, height });
  }
}

function paint(text: string, width: number, height: number) {
  const context = new WatermarkContext();
  drawWatermark(context as unknown as CanvasRenderingContext2D, text, width, height);
  return context;
}

function expectCompleteText(context: WatermarkContext, text: string) {
  expect(context.textCalls.length).toBeGreaterThan(0);
  expect(context.textCalls.length).toBeLessThanOrEqual(2);
  expect(
    context.textCalls
      .map((call) => call.text)
      .join('')
      .normalize('NFC')
      .replace(/\s/gu, ''),
  ).toBe(text.normalize('NFC').replace(/\s/gu, ''));
}

afterEach(() => vi.unstubAllGlobals());

describe('drawWatermark', () => {
  it('preserves accented, combining, and non-Latin author names without truncation', () => {
    const text = '© Zoë Nguyễn • Jose\u0301 García • 李小龍';
    const context = paint(text, 320, 180);
    expectCompleteText(context, text);
    for (const call of context.textCalls) {
      expect(call.left).toBeGreaterThanOrEqual(0);
      expect(call.right).toBeLessThanOrEqual(320);
    }
  });

  it.each([
    [1, 1],
    [12, 5],
    [64, 12],
    [160, 90],
  ])('fits a full 120-character unbroken name into a %s × %s image', (width, height) => {
    const text = 'É'.repeat(120);
    const context = paint(text, width, height);
    expectCompleteText(context, text);
    for (const call of context.textCalls) {
      expect(call.fontSize).toBeGreaterThan(0);
      expect(call.left).toBeGreaterThanOrEqual(-1e-6);
      expect(call.right).toBeLessThanOrEqual(width + 1e-6);
    }
    for (const rect of context.rectCalls) {
      expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1e-6);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1e-6);
    }
  });

  it('uses at most two complete lines for a long multiword name', () => {
    const text = 'Mária de los Ángeles Nguyễn Fernández '.repeat(3).trim();
    const context = paint(text, 240, 100);
    expectCompleteText(context, text);
  });

  it('balances canvas save/restore and restores the caller drawing state', () => {
    const context = paint('© Amélie', 800, 600);
    expect(context.saved).toBeGreaterThan(0);
    expect(context.restored).toBe(context.saved);
    expect(context).toMatchObject({
      font: '23px serif',
      fillStyle: '#123456',
      globalAlpha: 0.37,
      globalCompositeOperation: 'multiply',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      shadowColor: '#abcdef',
      shadowBlur: 4,
      shadowOffsetX: 3,
      shadowOffsetY: 2,
    });
  });

  it('draws nothing for an empty watermark', () => {
    const context = paint('', 800, 600);
    expect(context.textCalls).toHaveLength(0);
    expect(context.rectCalls).toHaveLength(0);
    expect(context.saved).toBe(context.restored);
  });
});

describe('ensureWatermarkFont', () => {
  it('waits for the font to load with the actual Unicode text before resolving', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const load = vi.fn(() => pending);
    vi.stubGlobal('document', { fonts: { load } });
    const text = 'Zoë Nguyễn 李小龍';
    let finished = false;
    const result = ensureWatermarkFont(text).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(load).toHaveBeenCalledWith(expect.any(String), text);
    expect(finished).toBe(false);
    complete();
    await result;
    expect(finished).toBe(true);
  });

  it('works when the Font Loading API is unavailable', async () => {
    vi.stubGlobal('document', {});
    await expect(ensureWatermarkFont('© Amélie')).resolves.toBeUndefined();
  });
});
