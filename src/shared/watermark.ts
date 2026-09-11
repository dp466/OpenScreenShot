type WatermarkContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface WatermarkOptions {
  /** Values are in canvas pixels. Defaults adapt to the output dimensions. */
  fontSize?: number;
  margin?: number;
  padding?: number;
}

/** All extension surfaces declare this bundled font; no remote font is requested. */
export async function ensureWatermarkFont(text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load('500 16px Roboto', text);
  } catch {
    // The local system sans-serif fallback still supports Unicode filenames.
  }
}

interface TextLine {
  text: string;
  width: number;
  left: number;
  ascent: number;
  descent: number;
}

function measureLine(ctx: WatermarkContext, text: string, size: number): TextLine {
  const metrics = ctx.measureText(text);
  const left = Math.max(0, metrics.actualBoundingBoxLeft || 0);
  const right = Math.max(metrics.width, metrics.actualBoundingBoxRight || 0);
  return {
    text,
    width: left + right,
    left,
    ascent: Math.max(size * 0.8, metrics.actualBoundingBoxAscent || 0),
    descent: Math.max(size * 0.25, metrics.actualBoundingBoxDescent || 0),
  };
}

/** Prefer a balanced word break, then split Unicode code points if necessary. */
function wrapLines(
  ctx: WatermarkContext,
  text: string,
  size: number,
  availableWidth: number,
): TextLine[] {
  const whole = measureLine(ctx, text, size);
  if (whole.width <= availableWidth) return [whole];
  const characters = Array.from(text);
  let best: TextLine[] = [whole];
  let bestWidth = whole.width;
  let wordBreak: TextLine[] | undefined;
  let wordWidth = Infinity;
  for (let i = 1; i < characters.length; i++) {
    const first = characters.slice(0, i).join('').trimEnd();
    const second = characters.slice(i).join('').trimStart();
    if (!first || !second) continue;
    const lines = [measureLine(ctx, first, size), measureLine(ctx, second, size)];
    const width = Math.max(...lines.map((line) => line.width));
    if (width < bestWidth) {
      bestWidth = width;
      best = lines;
    }
    if (/\s/u.test(characters[i - 1]) && width < wordWidth) {
      wordWidth = width;
      wordBreak = lines;
    }
  }
  return wordBreak && wordWidth <= availableWidth ? wordBreak : best;
}

/**
 * Draw a complete filename at the bottom-right of the supplied pixel rectangle.
 * At most two lines are used, shrinking even on tiny images instead of clipping
 * or truncating the name. The source image and the caller's drawing state remain
 * intact. Canvas text keeps accented and other Unicode names out of PDF encodings.
 */
export function drawWatermark(
  ctx: WatermarkContext,
  text: string,
  width: number,
  height: number,
  options: WatermarkOptions = {},
): void {
  const label = text;
  if (
    !label.trim() ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return;

  const margin = Math.max(0, Math.min(options.margin ?? 12, width * 0.025, height * 0.04));
  let size = Math.max(0.001, options.fontSize ?? Math.min(28, Math.max(12, width / 85)));
  const padding = Math.max(0, Math.min(options.padding ?? size * 0.4, width / 8, height / 8));
  const availableWidth = width - 2 * margin - 2 * padding;
  const availableHeight = height - 2 * margin - 2 * padding;

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.filter = 'none';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.direction = 'ltr';

    let lines: TextLine[] = [];
    let lineHeight = 0;
    let textHeight = 0;
    // Metrics can change slightly at different pixel sizes. Re-measure after
    // shrinking, with spare room to avoid edge clipping from rounding.
    for (let attempt = 0; attempt < 12; attempt++) {
      ctx.font = `500 ${size}px Roboto, Arial, sans-serif`;
      lines = wrapLines(ctx, label, size, availableWidth);
      lineHeight = Math.max(size * 1.3, ...lines.map((line) => line.ascent + line.descent));
      textHeight = lineHeight * lines.length;
      const textWidth = Math.max(...lines.map((line) => line.width));
      const scale = Math.min(1, availableWidth / textWidth, availableHeight / textHeight);
      if (scale >= 1) break;
      size *= scale * 0.98;
    }
    const textWidth = Math.max(...lines.map((line) => line.width));
    const boxWidth = Math.min(width - 2 * margin, textWidth + 2 * padding);
    const boxHeight = Math.min(height - 2 * margin, textHeight + 2 * padding);
    const x = width - margin - boxWidth;
    const y = height - margin - boxHeight;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = '#30343b';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      ctx.fillText(line.text, x + padding + line.left, y + padding + i * lineHeight + line.ascent);
    }
  } finally {
    ctx.restore();
  }
}
