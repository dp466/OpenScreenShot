/**
 * Page-context functions injected on demand via `chrome.scripting.executeScript`.
 *
 * IMPORTANT: every exported function here must be FULLY SELF-CONTAINED. When
 * injected with `{ func }`, Chrome serializes the function via `toString()` and
 * discards its closure — so no references to module-scope bindings are allowed
 * (only the function's own parameters and page-context globals like `document`,
 * `window`, `Image`, `getComputedStyle`). Helper code is therefore nested inside
 * each function that needs it. The functions are bundled into the service worker
 * (as part of its import graph) but are only ever *stringified* there, never
 * executed — so referencing DOM globals is safe at the type level and harmless at
 * runtime.
 */
import type { Metrics, TileSpec } from '../shared/types';

/**
 * Measure the page so the background can plan the scroll loop + canvas size.
 *
 * When the document itself doesn't scroll (common in SPAs like Gmail, Claude,
 * Notion — the body is pinned and an inner element scrolls), find that element,
 * tag it `data-oss-scroller`, and report ITS geometry + viewport rect so the
 * capture loop scrolls it and crops each tile to it.
 */
export function getMetrics(): Metrics {
  const de = document.documentElement;
  const dpr = window.devicePixelRatio || 1;
  const vw = Math.min(window.innerWidth, de.clientWidth || window.innerWidth);
  const vh = window.innerHeight;
  // Our own progress UI must never enlarge the measured document, including
  // when page CSS transforms an ancestor of its fixed-position host.
  const overlays = [...document.querySelectorAll<HTMLElement>('[data-oss-capture-overlay]')];
  const display = overlays.map((el) => [
    el.style.getPropertyValue('display'),
    el.style.getPropertyPriority('display'),
  ]);
  for (const overlay of overlays) overlay.style.setProperty('display', 'none', 'important');
  try {
    const root = document.scrollingElement || de;
    const docScrolls = root.scrollHeight > vh + 4;
    for (const old of document.querySelectorAll<HTMLElement>('[data-oss-scroller="1"]')) {
      delete old.dataset.ossScroller;
    }
    let scroller: HTMLElement | null = null;
    if (!docScrolls) {
      // Pick the dominant scrollable region in apps with a pinned document.
      let bestOverflow = vh * 0.5;
      for (const el of document.querySelectorAll<HTMLElement>('*')) {
        if (el.closest('[data-oss-capture-overlay]')) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
        const overflow = el.scrollHeight - el.clientHeight;
        if (overflow <= bestOverflow) continue;
        const r = el.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left));
        const visibleHeight = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
        if (visibleWidth < vw * 0.5 || visibleHeight < vh * 0.5) continue;
        bestOverflow = overflow;
        scroller = el;
      }
    }
    if (scroller) {
      scroller.dataset.ossScroller = '1';
      const r = scroller.getBoundingClientRect();
      const left = r.left + scroller.clientLeft;
      const top = r.top + scroller.clientTop;
      let x = Math.max(0, left);
      let y = Math.max(0, top);
      let right = Math.min(vw, left + scroller.clientWidth);
      let bottom = Math.min(vh, top + scroller.clientHeight);
      // An ancestor may clip the scrollable region before the browser viewport.
      for (let parent = scroller.parentElement; parent; parent = parent.parentElement) {
        const cs = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)) {
          x = Math.max(x, rect.left + parent.clientLeft);
          right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY)) {
          y = Math.max(y, rect.top + parent.clientTop);
          bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
        }
      }
      const width = Math.max(0, right - x);
      const height = Math.max(0, bottom - y);
      return {
        scrollHeight: scroller.scrollHeight,
        viewportHeight: height,
        viewportWidth: width,
        devicePixelRatio: dpr,
        container: { x, y, width, height },
      };
    }
    return {
      scrollHeight: root.scrollHeight,
      viewportHeight: vh,
      viewportWidth: vw,
      devicePixelRatio: dpr,
      container: null,
    };
  } finally {
    overlays.forEach((el, i) => {
      if (display[i][0]) el.style.setProperty('display', display[i][0], display[i][1]);
      else el.style.removeProperty('display');
    });
  }
}

/** Preserve exact inline styles and scroll offsets so finally can undo capture. */
export function prepareCapture(): void {
  const win = window as Window & {
    __ossCaptureControl?: { cancelled: boolean; onKeyDown: (event: KeyboardEvent) => void };
  };
  if (!win.__ossCaptureControl) {
    const state = {
      cancelled: false,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') state.cancelled = true;
      },
    };
    win.__ossCaptureControl = state;
    window.addEventListener('keydown', state.onKeyDown, true);
  }
  const de = document.documentElement;
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  for (const el of scroller ? [de, scroller] : [de]) {
    if (!el.dataset.ossScrollRestore) {
      el.dataset.ossScrollRestore = JSON.stringify({
        x: el === de ? window.scrollX : el.scrollLeft,
        y: el === de ? window.scrollY : el.scrollTop,
        behavior: el.style.getPropertyValue('scroll-behavior'),
        behaviorPriority: el.style.getPropertyPriority('scroll-behavior'),
        snap: el.style.getPropertyValue('scroll-snap-type'),
        snapPriority: el.style.getPropertyPriority('scroll-snap-type'),
      });
    }
    el.style.setProperty('scroll-behavior', 'auto', 'important');
    el.style.setProperty('scroll-snap-type', 'none', 'important');
  }
}

/** Hide repeated chrome, preserving existing styles and app scroll wrappers. */
export function hideFixedElements(): void {
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  for (const el of document.querySelectorAll<HTMLElement>('*')) {
    if (el.closest('[data-oss-capture-overlay]') || el.dataset.ossHidden === '1') continue;
    // A fixed SPA wrapper may contain the ENTIRE selected scrolling surface.
    if (scroller && (el === scroller || el.contains(scroller))) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      el.dataset.ossVisibilityRestore = JSON.stringify([
        el.style.getPropertyValue('visibility'),
        el.style.getPropertyPriority('visibility'),
      ]);
      el.dataset.ossHidden = '1';
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
}

/** Scroll to y and report the actual, potentially clamped, scroll position. */
export function scrollToPosition(y: number): { scrollY: number; atBottom: boolean } {
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  if (scroller) {
    scroller.scrollTop = y;
    const after = scroller.scrollTop;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return { scrollY: after, atBottom: after >= max - 1 };
  }
  window.scrollTo(0, y);
  const after = window.scrollY;
  const root = document.scrollingElement || document.documentElement;
  const max = root.scrollHeight - window.innerHeight;
  return { scrollY: after, atBottom: after >= max - 1 };
}

/**
 * Wait AFTER each actual scroll, then optionally wait for visible images to
 * finish loading and decoding. No src/lazy-loading attributes are rewritten,
 * and no fetch/Image requests are issued. CSS background images have no DOM
 * readiness API; the configurable settling delay applies to them as well.
 *
 * scrollY is the first VISIBLE content row (including a clipped container top),
 * while atBottom reports the true scroller boundary. All layout is remeasured
 * after waiting because lazy images can both grow and shrink the page.
 */
export async function scrollAndWait(
  y: number,
  delayMs: number,
  waitImages: boolean,
  imageTimeoutMs: number,
): Promise<
  Metrics & {
    scrollY: number;
    atBottom: boolean;
    pendingImages: number;
    failedImages: number;
    timedOut: boolean;
    cancelled: boolean;
  }
> {
  const de = document.documentElement;
  const scroller = document.querySelector<HTMLElement>('[data-oss-scroller="1"]');
  const win = window as Window & { __ossCaptureControl?: { cancelled: boolean } };
  const cancelled = () => win.__ossCaptureControl?.cancelled === true;
  const sleep = async (ms: number) => {
    const until = Date.now() + ms;
    while (!cancelled() && Date.now() < until) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, until - Date.now())));
    }
  };
  const boundedPaint = () =>
    new Promise<void>((resolve) => {
      let first = 0;
      let second = 0;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
        resolve();
      };
      // Background/occluded tabs can stop rAF entirely. The screenshot caller
      // separately verifies the tab can paint before actually taking a snapshot.
      const timeout = setTimeout(done, 250);
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(done);
      });
    });
  const measure = () => {
    const vw = Math.min(window.innerWidth, de.clientWidth || window.innerWidth);
    const vh = window.innerHeight;
    const overlays = [...document.querySelectorAll<HTMLElement>('[data-oss-capture-overlay]')];
    const display = overlays.map((el) => [
      el.style.getPropertyValue('display'),
      el.style.getPropertyPriority('display'),
    ]);
    for (const el of overlays) el.style.setProperty('display', 'none', 'important');
    try {
      if (scroller && !scroller.isConnected)
        throw new Error('The page replaced its scrolling region. Please capture again.');
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const left = r.left + scroller.clientLeft;
        const top = r.top + scroller.clientTop;
        let x = Math.max(0, left);
        let visibleY = Math.max(0, top);
        let right = Math.min(vw, left + scroller.clientWidth);
        let bottom = Math.min(vh, top + scroller.clientHeight);
        for (let parent = scroller.parentElement; parent; parent = parent.parentElement) {
          const cs = getComputedStyle(parent);
          const rect = parent.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)) {
            x = Math.max(x, rect.left + parent.clientLeft);
            right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
          }
          if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY)) {
            visibleY = Math.max(visibleY, rect.top + parent.clientTop);
            bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
          }
        }
        const width = Math.max(0, right - x);
        const height = Math.max(0, bottom - visibleY);
        return {
          scrollHeight: scroller.scrollHeight,
          viewportWidth: width,
          viewportHeight: height,
          devicePixelRatio: window.devicePixelRatio || 1,
          container: { x, y: visibleY, width, height },
          scrollY: scroller.scrollTop + (visibleY - top),
          atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1,
        };
      }
      const root = document.scrollingElement || de;
      return {
        scrollHeight: root.scrollHeight,
        viewportHeight: vh,
        viewportWidth: vw,
        devicePixelRatio: window.devicePixelRatio || 1,
        container: null,
        scrollY: window.scrollY,
        atBottom: window.scrollY >= root.scrollHeight - vh - 1,
      };
    } finally {
      overlays.forEach((el, i) => {
        if (display[i][0]) el.style.setProperty('display', display[i][0], display[i][1]);
        else el.style.removeProperty('display');
      });
    }
  };
  const cancelledResult = () => ({
    ...measure(),
    pendingImages: 0,
    failedImages: 0,
    timedOut: false,
    cancelled: true,
  });
  if (cancelled()) return cancelledResult();
  const requestedY = Number.isFinite(y) ? Math.max(0, y) : 0;
  // y means first visible content row to the caller, so compensate for any
  // viewport/ancestor clipping of the selected inner scrolling surface.
  const initial = measure();
  if (scroller) {
    const clippedTop = initial.scrollY - scroller.scrollTop;
    scroller.scrollTop = Math.max(0, requestedY - clippedTop);
  } else {
    window.scrollTo(window.scrollX, requestedY);
  }
  const settleMs = Number.isFinite(delayMs) ? Math.max(0, Math.min(60000, delayMs)) : 1500;
  await sleep(settleMs);
  if (cancelled()) return cancelledResult();
  await boundedPaint();
  if (cancelled()) return cancelledResult();

  const decoded = new Map<HTMLImageElement, { source: string; done: boolean }>();
  const pendingFadeImages = new Set<HTMLImageElement>();
  const visibleImages = () => {
    const metrics = measure();
    const c = metrics.container || {
      x: 0,
      y: 0,
      width: metrics.viewportWidth,
      height: metrics.viewportHeight,
    };
    return [...(scroller || document).querySelectorAll<HTMLImageElement>('img')].filter((img) => {
      if (img.closest('[data-oss-capture-overlay]')) return false;
      const rect = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')
        return false;
      if (rect.width <= 0 || rect.height <= 0) return false;
      let transparent = Number(cs.opacity) === 0;
      let left = Math.max(c.x, rect.left);
      let top = Math.max(c.y, rect.top);
      let right = Math.min(c.x + c.width, rect.right);
      let bottom = Math.min(c.y + c.height, rect.bottom);
      for (
        let parent = img.parentElement;
        parent && parent !== scroller;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        )
          return false;
        transparent ||= Number(style.opacity) === 0;
        const r = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
          left = Math.max(left, r.left + parent.clientLeft);
          right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth);
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
          top = Math.max(top, r.top + parent.clientTop);
          bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight);
        }
      }
      if (right <= left || bottom <= top) return false;
      // Lazy-image libraries often keep an in-viewport image (or its wrapper)
      // transparent until loading finishes. Track it through decoding even if
      // opacity is still zero; arbitrary fade animations are not awaited.
      if (transparent && !img.complete) pendingFadeImages.add(img);
      return !transparent || pendingFadeImages.has(img);
    });
  };
  const inspect = () => {
    let pendingImages = 0;
    let failedImages = 0;
    for (const img of visibleImages()) {
      const source = img.currentSrc || img.getAttribute('src') || '';
      // A src-less placeholder may be filled by application code later. The
      // explicit delay handles that; never start a request ourselves.
      if (!source && img.complete) continue;
      if (!img.complete) {
        pendingImages++;
        continue;
      }
      if (img.naturalWidth <= 0) {
        failedImages++;
        continue;
      }
      if (waitImages && typeof img.decode === 'function') {
        let status = decoded.get(img);
        if (!status || status.source !== source) {
          status = { source, done: false };
          decoded.set(img, status);
          const current = status;
          // Decode failures alone don't imply broken images (e.g. a source
          // changed). Each poll checks complete/naturalWidth/currentSrc again.
          try {
            img.decode().then(
              () => {
                current.done = true;
              },
              () => {
                current.done = true;
              },
            );
          } catch {
            current.done = true;
          }
        }
        if (!status.done) pendingImages++;
      }
    }
    return { pendingImages, failedImages };
  };
  const timeoutMs = Number.isFinite(imageTimeoutMs)
    ? Math.max(0, Math.min(60000, imageTimeoutMs))
    : 10000;
  const deadline = Date.now() + timeoutMs;
  let counts = inspect();
  if (waitImages) {
    while (!cancelled()) {
      while (!cancelled() && counts.pendingImages > 0 && Date.now() < deadline) {
        await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
        counts = inspect();
      }
      if (cancelled()) return cancelledResult();
      await boundedPaint();
      counts = inspect();
      // Page scripts can insert/swap an image at the paint boundary. Give it
      // the remaining budget rather than declaring a premature timeout.
      if (counts.pendingImages === 0 || Date.now() >= deadline) break;
    }
  }
  return {
    ...measure(),
    ...counts,
    timedOut: !cancelled() && waitImages && counts.pendingImages > 0,
    cancelled: cancelled(),
  };
}

/** Restore styles and scroll offsets, including when capture has failed. */
export function restoreCapture(): void {
  const win = window as Window & {
    __ossCaptureControl?: { cancelled: boolean; onKeyDown: (event: KeyboardEvent) => void };
  };
  if (win.__ossCaptureControl) {
    window.removeEventListener('keydown', win.__ossCaptureControl.onKeyDown, true);
    delete win.__ossCaptureControl;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-oss-hidden="1"]')) {
    try {
      const [value, priority] = JSON.parse(el.dataset.ossVisibilityRestore || '["", ""]');
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
    } catch {
      el.style.removeProperty('visibility');
    }
    delete el.dataset.ossVisibilityRestore;
    delete el.dataset.ossHidden;
  }
  const de = document.documentElement;
  const elements = [...document.querySelectorAll<HTMLElement>('[data-oss-scroll-restore]')];
  // Restore inner regions first, then the outer document while smooth scrolling
  // is still disabled. This also works when app code removed the scroller tag.
  for (const el of elements.reverse()) {
    try {
      const state = JSON.parse(el.dataset.ossScrollRestore || '{}');
      if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
        if (el === de) window.scrollTo(state.x, state.y);
        else {
          el.scrollLeft = state.x;
          el.scrollTop = state.y;
        }
      }
      if (state.behavior)
        el.style.setProperty('scroll-behavior', state.behavior, state.behaviorPriority);
      else el.style.removeProperty('scroll-behavior');
      if (state.snap) el.style.setProperty('scroll-snap-type', state.snap, state.snapPriority);
      else el.style.removeProperty('scroll-snap-type');
    } catch {
      /* Page code may have modified the temporary attributes. */
    }
    delete el.dataset.ossScrollRestore;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-oss-scroller="1"]')) {
    delete el.dataset.ossScroller;
  }
}

/**
 * Composite every tile onto a single canvas sized `width`×`height` (device px) and
 * return the result as a PNG data URL. Each tile is drawn at its vertical device
 * offset; overlapping tiles overwrite identical content, so no seams appear.
 */
export async function stitchTiles(
  tiles: TileSpec[],
  width: number,
  height: number,
  crop: { x: number; y: number; w: number; h: number } | null,
): Promise<string> {
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('tile load failed'));
      img.src = src;
    });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  for (const tile of tiles) {
    const img = await load(tile.dataUrl);
    if (crop) {
      // Inner-container capture: take only the container's slice of the viewport.
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, tile.y, crop.w, crop.h);
    } else {
      ctx.drawImage(img, 0, tile.y, img.naturalWidth, img.naturalHeight);
    }
  }
  return canvas.toDataURL('image/png');
}

/**
 * Crop a viewport capture (`dataUrl`, device px) to the given rectangle (device px)
 * and return the cropped PNG data URL. Used by region capture.
 */
export async function cropTile(
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<string> {
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('tile load failed'));
      img.src = src;
    });
  const img = await load(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
