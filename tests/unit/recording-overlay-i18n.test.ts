import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { mountRecordingOverlay } from '../../src/content/recording-overlay';
import english from '../../public/_locales/en/messages.json';
import french from '../../public/_locales/fr/messages.json';

/** Minimal DOM for exercising the function after Chrome-style serialization. */
class OverlayNode {
  children: OverlayNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = { toggle: vi.fn() };
  listeners: Record<string, () => void> = {};
  textContent = '';
  className = '';
  removed = false;

  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  appendChild(child: OverlayNode) {
    this.children.push(child);
  }
  insertBefore(child: OverlayNode, before: OverlayNode) {
    this.children.splice(this.children.indexOf(before), 0, child);
  }
  replaceChildren() {
    this.children = [];
  }
  attachShadow() {
    const shadow = new OverlayNode('shadow');
    this.children.push(shadow);
    return shadow;
  }
  addEventListener(event: string, listener: () => void) {
    this.listeners[event] = listener;
  }
  remove() {
    this.removed = true;
  }
}

function harness() {
  const nodes: OverlayNode[] = [];
  const intervals: (() => void)[] = [];
  const sendMessage = vi.fn(() => Promise.resolve());
  const nativeGetMessage = vi.fn(
    (id: string) => english[id as keyof typeof english]?.message ?? '',
  );
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    __ossRecOverlay: undefined as (() => void) | undefined,
  };
  let now = 10_000;
  const injected = runInNewContext(`(${mountRecordingOverlay.toString()})`, {
    window,
    document: {
      documentElement: new OverlayNode('html'),
      createElement: (tag: string) => {
        const node = new OverlayNode(tag);
        nodes.push(node);
        return node;
      },
    },
    chrome: {
      i18n: { getMessage: nativeGetMessage },
      runtime: { sendMessage, getURL: (path: string) => `chrome-extension://fake/${path}` },
    },
    Date: { now: () => now },
    setInterval: (callback: () => void) => intervals.push(callback),
    clearInterval: vi.fn(),
  }) as typeof mountRecordingOverlay;
  return {
    injected,
    nodes,
    intervals,
    sendMessage,
    nativeGetMessage,
    window,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    byId: (id: string) => nodes.find((node) => node.attributes['data-testid'] === id)!,
  };
}

const labels = (messages: typeof english | typeof french) =>
  Object.fromEntries(Object.entries(messages).map(([id, entry]) => [id, entry.message]));
const tracks = { mic: true, tabAudio: true, webcam: true };

describe('recording overlay localization across injection boundaries', () => {
  it('uses supplied French labels on an English browser after serialization', () => {
    const h = harness();
    expect(h.injected('segment', 0, false, tracks, true, true, false, labels(french))).toBe(
      'fresh',
    );
    const buttonLabels = h.nodes
      .filter((node) => node.tag === 'button')
      .map((node) => node.textContent);
    expect(buttonLabels).toContain(french.recOverlayPause.message);
    expect(buttonLabels).toContain(french.recOverlayStop.message);
    expect(buttonLabels).toContain(french.recOverlayCancel.message);
    expect(h.byId('rec-overlay-timer').textContent).toBe(french.recOverlayStarting.message);
    expect(h.byId('rec-overlay-warning').textContent).toBe(french.recOverlayNotSaving.message);
    expect(h.byId('rec-overlay-cam-warning').textContent).toBe(french.recOverlayCamDenied.message);
    expect(h.byId('rec-overlay-catcher-grip').attributes['aria-label']).toBe(
      french.recOverlayReveal.message,
    );
    expect(h.nativeGetMessage).not.toHaveBeenCalled();
  });

  it('changes mounted controls in place and preserves the clock, camera and cursor heartbeat', () => {
    const h = harness();
    h.injected('segment', 5000, true, tracks, false, false, true, labels(french));
    const host = h.byId('rec-overlay-host');
    const camera = h.byId('rec-overlay-cam');
    const cleanup = h.window.__ossRecOverlay;
    const intervalCount = h.intervals.length;
    h.intervals[1]();
    h.advance(2000);

    expect(h.injected('segment', 2000, true, tracks, false, false, true, labels(english))).toBe(
      'synced',
    );
    expect(h.byId('rec-overlay-host')).toBe(host);
    expect(h.window.__ossRecOverlay).toBe(cleanup);
    expect(camera.removed).toBe(false);
    expect(h.intervals).toHaveLength(intervalCount);
    expect(h.byId('rec-overlay-timer').textContent).toBe('0:05');
    const buttons = h.nodes.filter((node) => node.tag === 'button');
    expect(buttons.map((node) => node.textContent)).toEqual(['Resume', 'Stop', 'Cancel', '']);
    expect(h.byId('rec-overlay-catcher-grip').attributes['aria-label']).toBe(
      english.recOverlayReveal.message,
    );

    h.intervals[1]();
    const batches = h.sendMessage.mock.calls as unknown as [{ seq: number; segmentId: string }][];
    expect(batches.map(([batch]) => batch.seq)).toEqual([0, 1]);
    expect(batches.map(([batch]) => batch.segmentId)).toEqual(['segment', 'segment']);
    buttons[1].listeners.click();
    expect(h.sendMessage).toHaveBeenLastCalledWith({ type: 'REC_STOP' });
  });

  it('retains native fallback for callers that omit translated labels', () => {
    const h = harness();
    h.injected('segment', 0, false, tracks, false, false, false);
    expect(h.byId('rec-overlay-timer').textContent).toBe(english.recOverlayStarting.message);
    expect(h.nativeGetMessage).toHaveBeenCalledWith('recOverlayStop');
  });
});
