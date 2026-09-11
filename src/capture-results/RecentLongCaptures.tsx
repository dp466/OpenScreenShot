import { useEffect, useState } from 'preact/hooks';
import { listCaptureBundles, type CaptureBundle } from '../shared/capture-bundles';
import { getUiLanguage } from '../shared/i18n';
import { translateCaptureMessage } from '../shared/capture-message-i18n';

/** A closed results tab can always be reopened from the capture picker. */
export function RecentLongCaptures() {
  const [bundles, setBundles] = useState<CaptureBundle[]>([]);
  const [error, setError] = useState('');
  const language = getUiLanguage();
  const fr = language.startsWith('fr');
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      void listCaptureBundles()
        .then((items) => {
          if (mounted) setBundles(items.filter((item) => item.parts.length > 0));
        })
        .catch(() => {
          /* An unavailable history does not block a new capture. */
        });
    const changed = (_changes: unknown, area: string) => {
      if (area === 'local') refresh();
    };
    refresh();
    chrome.storage.onChanged.addListener(changed);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  if (!bundles.length) return null;
  return (
    <section aria-label={fr ? 'Captures longues récentes' : 'Recent long captures'}>
      <span class="settings-section">
        {fr ? 'Captures longues récentes' : 'Recent long captures'}
      </span>
      {bundles.map((bundle) => (
        <button
          class="mode-card"
          key={bundle.id}
          onClick={() => {
            void chrome.tabs
              .create({
                url:
                  chrome.runtime.getURL('src/capture-results/index.html') +
                  '?id=' +
                  encodeURIComponent(bundle.id),
              })
              .then(() => window.close())
              .catch(() =>
                setError(translateCaptureMessage('Could not open this capture.', language)),
              );
          }}
        >
          <span class="mode-text">
            <span class="mode-title">
              {bundle.title || (fr ? 'Capture longue' : 'Long capture')}
            </span>
            <span class="mode-sub">
              {bundle.parts.length} sections · {bundle.height.toLocaleString(getUiLanguage())} px
              {bundle.incomplete ? (fr ? ' · Partielle' : ' · Partial') : ''}
            </span>
          </span>
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
