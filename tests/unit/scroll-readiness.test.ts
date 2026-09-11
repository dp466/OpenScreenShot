import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMetrics,
  hideFixedElements,
  prepareCapture,
  restoreCapture,
  scrollAndWait,
} from '../../src/content/scroll-capture';

class FakeStyle {
  values = new Map<string, [string, string]>();
  getPropertyValue(key: string) {
    return this.values.get(key)?.[0] || '';
  }
  getPropertyPriority(key: string) {
    return this.values.get(key)?.[1] || '';
  }
  setProperty(key: string, value: string, priority = '') {
    this.values.set(key, [value, priority]);
  }
  removeProperty(key: string) {
    this.values.delete(key);
  }
}
class FakeElement {
  dataset: Record<string, string> = {};
  style = new FakeStyle();
  css: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  clientLeft = 0;
  clientTop = 0;
  clientWidth = 800;
  clientHeight = 600;
  scrollHeight = 600;
  scrollLeft = 0;
  private top = 0;
  isConnected = true;
  tag = 'div';
  rect = { left: 0, top: 0, width: 800, height: 600 };
  complete = true;
  naturalWidth = 100;
  currentSrc = 'https://private.example/picture.png';
  decode = vi.fn(() => Promise.resolve());
  get scrollTop() {
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
  }
  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }
  getAttribute(name: string) {
    return name === 'src' ? this.currentSrc : null;
  }
  contains(other: FakeElement) {
    for (let node: FakeElement | null = other; node; node = node.parentElement)
      if (node === this) return true;
    return false;
  }
  closest(selector: string): FakeElement | null {
    if (matches(this, selector)) return this;
    for (let node = this.parentElement; node; node = node.parentElement)
      if (matches(node, selector)) return node;
    return null;
  }
  querySelectorAll(selector: string) {
    return elements.filter((el) => el !== this && this.contains(el) && matches(el, selector));
  }
}
function matches(el: FakeElement, selector: string) {
  if (selector === '*') return true;
  if (selector === 'img') return el.tag === 'img';
  if (selector === '[data-oss-capture-overlay]') return 'ossCaptureOverlay' in el.dataset;
  if (selector === '[data-oss-scroller="1"]') return el.dataset.ossScroller === '1';
  if (selector === '[data-oss-hidden="1"]') return el.dataset.ossHidden === '1';
  if (selector === '[data-oss-scroll-restore]') return 'ossScrollRestore' in el.dataset;
  throw new Error(`Unhandled selector ${selector}`);
}
let de: FakeElement;
let elements: FakeElement[];
let listeners: Set<(event: { key: string }) => void>;
let win: {
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  scrollTo: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
function element(parent = de) {
  const el = new FakeElement();
  el.parentElement = parent;
  elements.push(el);
  return el;
}
function image(parent = de) {
  const img = element(parent);
  img.tag = 'img';
  img.rect = { left: 30, top: 30, width: 100, height: 100 };
  return img;
}
// executeScript serializes exported functions, discarding all module bindings.
const injectedScrollAndWait = new Function(
  `return (${scrollAndWait.toString()})`,
)() as typeof scrollAndWait;

beforeEach(() => {
  vi.useFakeTimers();
  de = new FakeElement();
  de.scrollHeight = 2400;
  elements = [de];
  listeners = new Set();
  win = {
    innerWidth: 800,
    innerHeight: 600,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    scrollTo: vi.fn((x: number, y: number) => {
      win.scrollX = x;
      win.scrollY = Math.max(0, Math.min(y, de.scrollHeight - win.innerHeight));
    }),
    addEventListener: vi.fn((_type, fn) => listeners.add(fn)),
    removeEventListener: vi.fn((_type, fn) => listeners.delete(fn)),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    documentElement: de,
    scrollingElement: de,
    querySelectorAll: (selector: string) => elements.filter((el) => matches(el, selector)),
    querySelector: (selector: string) => elements.find((el) => matches(el, selector)) || null,
  });
  vi.stubGlobal('getComputedStyle', (el: FakeElement) => ({
    opacity: '1',
    display: 'block',
    visibility: el.style.getPropertyValue('visibility') || 'visible',
    position: 'static',
    overflowX: 'visible',
    overflowY: 'visible',
    ...el.css,
  }));
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) =>
    setTimeout(() => cb(Date.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('post-scroll capture readiness', () => {
  it('waits after scrolling, then remeasures a page which shrinks while an image loads', async () => {
    const img = image();
    img.complete = false;
    const ready = injectedScrollAndWait(1500, 200, true, 1000);
    let resolved = false;
    void ready.then(() => {
      resolved = true;
    });
    expect(win.scrollY).toBe(1500);
    await vi.advanceTimersByTimeAsync(199);
    expect(resolved).toBe(false);
    setTimeout(() => {
      img.complete = true;
      de.scrollHeight = 1200;
      win.scrollY = 600;
    }, 80);
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({
      scrollY: 600,
      scrollHeight: 1200,
      atBottom: true,
      pendingImages: 0,
      timedOut: false,
    });
    expect(img.decode).toHaveBeenCalledOnce();
  });

  it('ignores unloaded offscreen and CSS-hidden images', async () => {
    const offscreen = image();
    offscreen.complete = false;
    offscreen.rect.top = 1000;
    const hidden = image();
    hidden.complete = false;
    hidden.css.visibility = 'hidden';
    const start = Date.now();
    const ready = injectedScrollAndWait(0, 500, true, 10000);
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({ pendingImages: 0, timedOut: false });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(offscreen.decode).not.toHaveBeenCalled();
  });

  it.each(['image', 'wrapper'])(
    'waits for pending fade-in images under opacity:0 on the %s, including decoding',
    async (opacityTarget) => {
      const wrapper = element();
      const img = image(wrapper);
      (opacityTarget === 'image' ? img : wrapper).css.opacity = '0';
      img.complete = false;
      img.decode = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 150)));
      const ready = injectedScrollAndWait(0, 100, true, 1000);
      let resolved = false;
      void ready.then(() => {
        resolved = true;
      });
      setTimeout(() => {
        img.complete = true;
      }, 250);
      await vi.advanceTimersByTimeAsync(300);
      expect(resolved).toBe(false);
      await vi.runAllTimersAsync();
      expect(img.decode).toHaveBeenCalledOnce();
      expect(await ready).toMatchObject({ pendingImages: 0, timedOut: false });
    },
  );

  it.each([{ display: 'none' }, { visibility: 'hidden' }])(
    'still ignores opacity-zero images that are CSS-hidden: %j',
    async (css) => {
      const img = image();
      img.css = { ...css, opacity: '0' };
      img.complete = false;
      const ready = injectedScrollAndWait(0, 100, true, 1000);
      await vi.runAllTimersAsync();
      expect(await ready).toMatchObject({ pendingImages: 0, timedOut: false });
      expect(img.decode).not.toHaveBeenCalled();
    },
  );

  it('times out visible stalled images and does not hang if animation frames stop', async () => {
    const stalled = image();
    stalled.complete = false;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const start = Date.now();
    const ready = injectedScrollAndWait(99999, 100, true, 400);
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({
      scrollY: 1800,
      atBottom: true,
      pendingImages: 1,
      timedOut: true,
    });
    expect(Date.now() - start).toBe(1000);
    expect(stalled.decode).not.toHaveBeenCalled();
  });

  it('waits for decoding and reports failed image loads without blocking for the full timeout', async () => {
    const loaded = image();
    loaded.decode = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const broken = image();
    broken.naturalWidth = 0;
    const ready = injectedScrollAndWait(0, 0, true, 10000);
    let resolved = false;
    void ready.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(resolved).toBe(false);
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({ pendingImages: 0, failedImages: 1, timedOut: false });
    expect(broken.decode).not.toHaveBeenCalled();
  });

  it('waits for an image added by page code at the final paint boundary', async () => {
    const ready = injectedScrollAndWait(0, 0, true, 1000);
    setTimeout(() => {
      const late = image();
      late.complete = false;
      setTimeout(() => {
        late.complete = true;
      }, 150);
    }, 40);
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({ pendingImages: 0, timedOut: false });
  });

  it('skips image waits when disabled, while retaining the configured scroll delay', async () => {
    image().complete = false;
    const start = Date.now();
    const ready = injectedScrollAndWait(0, 300, false, 10000);
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({ pendingImages: 1, timedOut: false });
    expect(Date.now() - start).toBe(332);
  });

  it('Escape cancels a long post-scroll wait promptly and restoration removes its listener', async () => {
    prepareCapture();
    const ready = injectedScrollAndWait(500, 60000, true, 60000);
    setTimeout(() => {
      for (const fn of listeners) fn({ key: 'Escape' });
    }, 120);
    const start = Date.now();
    await vi.runAllTimersAsync();
    expect(await ready).toMatchObject({ cancelled: true, timedOut: false });
    expect(Date.now() - start).toBeLessThanOrEqual(150);
    restoreCapture();
    expect(listeners.size).toBe(0);
    expect(win.scrollY).toBe(0);
  });
});

describe('capture geometry and restoration', () => {
  it('clips an inner scroller to the visible viewport and returns the first visible row', async () => {
    de.scrollHeight = 600;
    const scroller = element();
    scroller.css.overflowY = 'auto';
    scroller.rect = { left: -10, top: -20, width: 820, height: 700 };
    scroller.clientWidth = 820;
    scroller.clientHeight = 700;
    scroller.scrollHeight = 2400;
    expect(getMetrics()).toMatchObject({
      viewportWidth: 800,
      viewportHeight: 600,
      container: { x: 0, y: 0, width: 800, height: 600 },
    });
    const ready = injectedScrollAndWait(620, 0, false, 0);
    await vi.runAllTimersAsync();
    expect(scroller.scrollTop).toBe(600);
    expect(await ready).toMatchObject({ scrollY: 620, atBottom: false });
  });

  it('preserves fixed app wrappers and restores exact scroll and inline styles', () => {
    de.style.setProperty('scroll-behavior', 'smooth', 'important');
    de.style.setProperty('scroll-snap-type', 'y mandatory');
    win.scrollY = 123;
    const wrapper = element();
    wrapper.css.position = 'fixed';
    const scroller = element(wrapper);
    scroller.dataset.ossScroller = '1';
    scroller.scrollHeight = 2000;
    scroller.scrollTop = 234;
    scroller.style.setProperty('scroll-behavior', 'smooth');
    const sticky = element(scroller);
    sticky.css.position = 'sticky';
    sticky.style.setProperty('visibility', 'collapse', 'important');
    prepareCapture();
    hideFixedElements();
    hideFixedElements(); // repeated calls must not overwrite the original value
    expect(wrapper.dataset.ossHidden).toBeUndefined();
    expect(sticky.style.getPropertyValue('visibility')).toBe('hidden');
    win.scrollY = 500;
    scroller.scrollTop = 1000;
    restoreCapture();
    expect(win.scrollY).toBe(123);
    expect(scroller.scrollTop).toBe(234);
    expect(de.style.getPropertyValue('scroll-behavior')).toBe('smooth');
    expect(de.style.getPropertyPriority('scroll-behavior')).toBe('important');
    expect(de.style.getPropertyValue('scroll-snap-type')).toBe('y mandatory');
    expect(scroller.style.getPropertyValue('scroll-behavior')).toBe('smooth');
    expect(sticky.style.getPropertyValue('visibility')).toBe('collapse');
    expect(sticky.style.getPropertyPriority('visibility')).toBe('important');
    expect(scroller.dataset.ossScroller).toBeUndefined();
  });

  it('does not include progress-overlay overflow in page height and restores its display', async () => {
    const overlay = element();
    overlay.dataset.ossCaptureOverlay = '1';
    overlay.style.setProperty('display', 'block', 'important');
    Object.defineProperty(de, 'scrollHeight', {
      get: () => (overlay.style.getPropertyValue('display') === 'none' ? 2400 : 9000),
    });
    expect(getMetrics().scrollHeight).toBe(2400);
    expect(overlay.style.getPropertyValue('display')).toBe('block');
    const ready = injectedScrollAndWait(0, 0, false, 0);
    await vi.runAllTimersAsync();
    expect((await ready).scrollHeight).toBe(2400);
    expect(overlay.style.getPropertyValue('display')).toBe('block');
    expect(overlay.style.getPropertyPriority('display')).toBe('important');
  });
});
