import { makeThumbnail } from './thumbnail';

/** A long capture is persisted as bounded image sections, never one giant canvas. */
export interface CapturePart {
  index: number;
  width: number;
  height: number;
  y: number;
  thumbnail?: string;
}

export interface CaptureBundle {
  id: string;
  title: string;
  url: string;
  output: 'pdf' | 'png';
  width: number;
  height: number;
  parts: CapturePart[];
  warnings: string[];
  incomplete: boolean;
  createdAt: number;
}

interface StoredBundle extends CaptureBundle {
  imageBytes: number;
  finishedAt?: number;
}

export const CAPTURE_BUNDLE_BYTES_LIMIT = 256 * 1024 * 1024;
/** Completed captures retained in addition to the newly created capture. */
export const CAPTURE_BUNDLE_HISTORY_LIMIT = 3;
const INDEX_KEY = 'openscreenshot:capture-bundles';
const metadataKey = (id: string) => `openscreenshot:capture-bundle:${id}`;
const partKey = (id: string, index: number) => `openscreenshot:capture-part:${id}:${index}`;
let queue: Promise<void> = Promise.resolve();

/** Web Locks also serialize the service worker with results tabs. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('openscreenshot:capture-bundles', fn);
    }
    return fn();
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readIndex(): Promise<string[]> {
  const data = await chrome.storage.local.get(INDEX_KEY);
  return (data[INDEX_KEY] as string[] | undefined) ?? [];
}

async function readMetadata(id: string): Promise<StoredBundle | null> {
  const key = metadataKey(id);
  const data = await chrome.storage.local.get(key);
  return (data[key] as StoredBundle | undefined) ?? null;
}

async function removeStoredBundle(bundle: StoredBundle): Promise<void> {
  await chrome.storage.local.remove([
    metadataKey(bundle.id),
    ...bundle.parts.map((part) => partKey(bundle.id, part.index)),
  ]);
}

export async function createCaptureBundle(input: {
  title: string;
  url: string;
  output: 'pdf' | 'png';
}): Promise<CaptureBundle> {
  return locked(async () => {
    const ids = await readIndex();
    const retained: string[] = [];
    const evicted: StoredBundle[] = [];
    let completed = 0;
    for (const id of ids) {
      const old = await readMetadata(id);
      if (!old) continue;
      // An unfinished capture is never silently removed by starting another.
      if (old.finishedAt === undefined || completed++ < CAPTURE_BUNDLE_HISTORY_LIMIT) {
        retained.push(id);
      } else {
        evicted.push(old);
      }
    }
    const bundle: StoredBundle = {
      ...input,
      id: crypto.randomUUID(),
      width: 0,
      height: 0,
      parts: [],
      warnings: [],
      incomplete: true,
      createdAt: Date.now(),
      imageBytes: 0,
    };
    await chrome.storage.local.set({
      [metadataKey(bundle.id)]: bundle,
      [INDEX_KEY]: [bundle.id, ...retained],
    });
    for (const old of evicted) await removeStoredBundle(old);
    return bundle;
  });
}

export async function appendCapturePart(
  id: string,
  input: { dataUrl: string; width: number; height: number; y: number },
): Promise<CapturePart> {
  if (!input.dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Capture section must be a local PNG image.');
  }
  if (
    ![input.width, input.height, input.y].every(Number.isSafeInteger) ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.y < 0
  ) {
    throw new Error('Invalid capture section dimensions.');
  }
  return locked(async () => {
    const bundle = await readMetadata(id);
    if (!bundle) throw new Error('The local capture is no longer available.');
    if (bundle.finishedAt !== undefined) throw new Error('This capture is already finished.');
    if (input.y !== bundle.height || (bundle.width !== 0 && input.width !== bundle.width)) {
      throw new Error('Capture sections must have the same width and join without gaps.');
    }
    const checkSize = (bytes: number) => {
      if (bundle.imageBytes + bytes > CAPTURE_BUNDLE_BYTES_LIMIT) {
        throw new Error(
          'The capture reached its 256 MiB local storage limit. Earlier sections have been preserved.',
        );
      }
    };
    checkSize(input.dataUrl.length);
    let thumbnail: string | undefined;
    try {
      thumbnail = await makeThumbnail(input.dataUrl);
    } catch {
      // The full-resolution section remains usable if preview encoding fails.
    }
    const bytes = input.dataUrl.length + (thumbnail?.length ?? 0);
    checkSize(bytes);
    const part: CapturePart = {
      index: bundle.parts.length,
      width: input.width,
      height: input.height,
      y: input.y,
      ...(thumbnail ? { thumbnail } : {}),
    };
    const updated: StoredBundle = {
      ...bundle,
      width: input.width,
      height: input.y + input.height,
      imageBytes: bundle.imageBytes + bytes,
      parts: [...bundle.parts, part],
    };
    await chrome.storage.local.set({
      [partKey(id, part.index)]: input.dataUrl,
      [metadataKey(id)]: updated,
    });
    return part;
  });
}

export async function finishCaptureBundle(
  id: string,
  input: { height: number; warnings: string[]; incomplete: boolean },
): Promise<void> {
  return locked(async () => {
    const bundle = await readMetadata(id);
    if (!bundle) throw new Error('The local capture is no longer available.');
    // Only persisted rows count as captured height; never describe uncaptured
    // content as pixels in the result or allocate a transparent tail for it.
    const heightMismatch = input.height !== bundle.height;
    const warnings = [...input.warnings];
    if (heightMismatch)
      warnings.push(
        'Only saved sections are included; the capture height changed before completion.',
      );
    await chrome.storage.local.set({
      [metadataKey(id)]: {
        ...bundle,
        warnings: [...new Set(warnings)],
        incomplete: input.incomplete || heightMismatch,
        finishedAt: Date.now(),
      } satisfies StoredBundle,
    });
  });
}

export async function getCaptureBundle(id: string): Promise<CaptureBundle | null> {
  return readMetadata(id);
}

/** Metadata and small thumbnails only; used to reopen a closed results tab. */
export async function listCaptureBundles(): Promise<CaptureBundle[]> {
  const bundles: CaptureBundle[] = [];
  for (const id of await readIndex()) {
    const bundle = await readMetadata(id);
    if (bundle) bundles.push(bundle);
  }
  return bundles;
}

export async function readCapturePart(id: string, index: number): Promise<string> {
  const key = partKey(id, index);
  const data = await chrome.storage.local.get(key);
  const dataUrl = data[key];
  if (typeof dataUrl !== 'string')
    throw new Error('This saved capture section is no longer available.');
  return dataUrl;
}

export async function deleteCaptureBundle(id: string): Promise<void> {
  return locked(async () => {
    const bundle = await readMetadata(id);
    if (bundle) await removeStoredBundle(bundle);
    await chrome.storage.local.set({
      [INDEX_KEY]: (await readIndex()).filter((item) => item !== id),
    });
  });
}
