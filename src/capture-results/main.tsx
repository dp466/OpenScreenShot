import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  deleteCaptureBundle,
  getCaptureBundle,
  readCapturePart,
  setCaptureExportName,
  type CaptureBundle,
  type CapturePart,
} from '../shared/capture-bundles';
import { setLastCapture } from '../shared/storage';
import { buildPdfSequential } from '../editor/pdf-writer';
import { imageBlob, pdfPages, pdfSliceHeight, watermarkPng } from './export';
import { getMessage, getUiLanguage } from '../shared/i18n';
import { translateCaptureMessage } from '../shared/capture-message-i18n';
import { ExportNameDialog } from '../shared/ExportNameDialog';
import { suggestExportName, validateExportName } from '../shared/export-name';
import './style.css';

const language = getUiLanguage();
const fr = language.startsWith('fr');
const text = fr
  ? {
      heading: 'Votre capture',
      intro: 'La capture conserve sa résolution. Les pages longues sont divisées en sections.',
      local: 'Traitement et stockage locaux. Aucun téléversement ni synchronisation.',
      folder:
        'Choisissez un dossier qui ne se synchronise pas avec OneDrive, iCloud ou un autre service.',
      retained:
        'Les trois captures longues précédentes sont conservées. Enregistrez les fichiers à conserver.',
      loading: 'Chargement de la capture…',
      missing: 'Cette capture locale n’est plus disponible.',
      partial: 'Capture partielle — vérifiez les avertissements avant de l’utiliser.',
      review: 'Capture enregistrée — certains éléments nécessitent une vérification.',
      ready: 'Capture enregistrée',
      pdf: 'Enregistrer un PDF',
      png: 'Enregistrer tous les PNG',
      allHint: 'Pour les PNG, le navigateur demande un emplacement pour chaque section.',
      erase: 'Supprimer cette capture locale',
      eraseHint:
        'Les fichiers téléchargés et les copies ouvertes dans l’éditeur ou conservées dans l’historique des captures ne sont pas supprimés. Supprimez-les séparément.',
      saved: 'Téléchargement lancé.',
      removed: 'La capture a été supprimée du stockage local de l’extension.',
      preparing: 'Préparation…',
      part: 'Section',
      sections: 'sections',
      edit: 'Ouvrir dans l’éditeur',
      pngOne: 'Enregistrer le PNG',
      wait: 'Veuillez patienter…',
      screenshot: 'Capture d’écran',
      progress: (page: number, total: number) => `Préparation du PDF : page ${page} sur ${total}…`,
    }
  : {
      heading: 'Your capture',
      intro: 'The capture keeps its original resolution. Long pages are saved in sections.',
      local: 'Processed and stored locally. No uploads or synchronization.',
      folder: 'Choose a folder that is not synchronized with OneDrive, iCloud, or another service.',
      retained: 'The three previous long captures are retained. Download files you want to keep.',
      loading: 'Loading capture…',
      missing: 'This local capture is no longer available.',
      partial: 'Partial capture — review the warnings before using it.',
      review: 'Capture saved — some content needs your review.',
      ready: 'Capture saved',
      pdf: 'Save one PDF',
      png: 'Save all PNGs',
      allHint: 'For PNGs, your browser asks for a save location for each section.',
      erase: 'Delete this local capture',
      eraseHint:
        'Downloaded files and copies opened in the editor or kept in recent capture history are not deleted. Delete those separately.',
      saved: 'Download started.',
      removed: 'The capture was deleted from the extension’s local storage.',
      preparing: 'Preparing…',
      part: 'Section',
      sections: 'sections',
      edit: 'Open in editor',
      pngOne: 'Save PNG',
      wait: 'Please wait…',
      screenshot: 'Screenshot',
      progress: (page: number, total: number) => `Preparing PDF: page ${page} of ${total}…`,
    };

document.documentElement.lang = fr ? 'fr' : 'en';
document.title = `OpenScreenShot — ${text.heading}`;

function filename(bundle: CaptureBundle): string {
  if (bundle.requestFilename) return validateExportName(bundle.exportName ?? '');
  const name = Array.from(bundle.title, (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  )
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 90);
  return name || (fr ? 'capture-ecran' : 'screenshot');
}

function hasConfirmedName(bundle: CaptureBundle): boolean {
  try {
    validateExportName(bundle.exportName ?? '');
    return true;
  } catch {
    return false;
  }
}

async function saveBlob(blob: Blob, name: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: name, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function App() {
  const [bundle, setBundle] = useState<CaptureBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const exportAllowed = !!bundle && (!bundle.requestFilename || hasConfirmedName(bundle));

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      setLoading(false);
      return;
    }
    getCaptureBundle(id)
      .then((saved) => {
        setBundle(saved);
        setShowNameDialog(!!saved?.requestFilename && !hasConfirmedName(saved));
      })
      .catch((err: unknown) => {
        setError(
          translateCaptureMessage(err instanceof Error ? err.message : String(err), language),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus(text.preparing);
    try {
      await action();
    } catch (err) {
      setStatus('');
      setError(translateCaptureMessage(err instanceof Error ? err.message : String(err), language));
    } finally {
      setBusy(false);
    }
  }

  async function savePart(part: CapturePart) {
    if (!bundle || !exportAllowed) return;
    const data = await readCapturePart(bundle.id, part.index);
    const base = filename(bundle);
    await saveBlob(
      bundle.requestFilename ? await watermarkPng(data, base) : imageBlob(data),
      `${base}_part-${String(part.index + 1).padStart(3, '0')}.png`,
    );
    setStatus(text.saved);
  }

  async function savePdf() {
    if (!bundle?.parts.length || !exportAllowed) return;
    const base = filename(bundle);
    const count = Math.ceil(bundle.height / pdfSliceHeight(bundle.width));
    const blob = await buildPdfSequential(
      pdfPages(
        bundle,
        (page, total) => setStatus(text.progress(page, total)),
        bundle.requestFilename ? base : undefined,
      ),
      count,
    );
    await saveBlob(blob, `${base}.pdf`);
    setStatus(text.saved);
  }

  async function openEditor(part: CapturePart) {
    if (!bundle || !exportAllowed) return;
    await setLastCapture({
      dataUrl: await readCapturePart(bundle.id, part.index),
      width: part.width,
      height: part.height,
      mode: bundle.mode ?? 'full-page',
      title:
        bundle.parts.length === 1
          ? bundle.title
          : `${bundle.title} — ${text.part} ${part.index + 1}`,
      url: bundle.url,
      capturedAt: bundle.createdAt,
      ...(bundle.requestFilename ? { exportName: filename(bundle), filenameWatermark: true } : {}),
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/index.html') });
    setStatus('');
  }

  return (
    <main>
      <header>
        <div class="brand">
          OpenScreenShot <span>Local</span>
        </div>
        <h1>{text.heading}</h1>
        <p>{text.intro}</p>
      </header>
      {loading ? (
        <p role="status">{text.loading}</p>
      ) : !bundle ? (
        <p role="status">{deleted ? text.removed : text.missing}</p>
      ) : (
        <>
          <section class="summary" aria-label={text.heading}>
            <h2>{bundle.title || text.screenshot}</h2>
            <p class="dimensions">
              {bundle.width.toLocaleString(getUiLanguage())} ×{' '}
              {bundle.height.toLocaleString(getUiLanguage())} px · {bundle.parts.length}{' '}
              {text.sections}
            </p>
            <p class="source">{bundle.url}</p>
            <div class={bundle.incomplete || bundle.warnings.length ? 'notice warning' : 'notice'}>
              <strong>
                {bundle.incomplete
                  ? text.partial
                  : bundle.warnings.length
                    ? text.review
                    : text.ready}
              </strong>
              {bundle.warnings.length > 0 && (
                <ul>
                  {bundle.warnings.map((warning) => (
                    <li key={warning}>{translateCaptureMessage(warning, language)}</li>
                  ))}
                </ul>
              )}
            </div>
            {bundle.requestFilename && (
              <div class="capture-export-name">
                <div>
                  <strong>{getMessage('exportNameLabel')}</strong>
                  {bundle.exportName && <p class="capture-export-basename">{bundle.exportName}</p>}
                  <p class="hint">{getMessage('exportNameHint')}</p>
                </div>
                <button disabled={busy} onClick={() => setShowNameDialog(true)}>
                  {getMessage(bundle.exportName ? 'exportNameEdit' : 'exportNameTitle')}
                </button>
              </div>
            )}
            <div class="actions">
              <button
                class={bundle.output === 'pdf' ? 'primary' : ''}
                disabled={busy || !bundle.parts.length || !exportAllowed}
                onClick={() => void perform(savePdf)}
              >
                {text.pdf}
              </button>
              <button
                class={bundle.output === 'png' ? 'primary' : ''}
                disabled={busy || !bundle.parts.length || !exportAllowed}
                onClick={() =>
                  void perform(async () => {
                    for (const part of bundle.parts) await savePart(part);
                  })
                }
              >
                {text.png}
              </button>
            </div>
            <p class="hint">{text.folder}</p>
            <p class="hint">{text.allHint}</p>
          </section>
          <section class="parts" aria-label={text.sections}>
            {bundle.parts.map((part) => (
              <article class="part" key={part.index}>
                <div class="preview">
                  {part.thumbnail && (
                    <img src={part.thumbnail} alt={`${text.part} ${part.index + 1}`} />
                  )}
                </div>
                <div class="part-detail">
                  <h2>
                    {text.part} {part.index + 1}
                  </h2>
                  <p>
                    {part.width.toLocaleString(getUiLanguage())} ×{' '}
                    {part.height.toLocaleString(getUiLanguage())} px
                  </p>
                  <p class="hint">
                    {part.y.toLocaleString(getUiLanguage())}–
                    {(part.y + part.height).toLocaleString(getUiLanguage())} px
                  </p>
                </div>
                <div class="part-actions">
                  <button
                    disabled={busy || !exportAllowed}
                    onClick={() => void perform(() => savePart(part))}
                  >
                    {text.pngOne}
                  </button>
                  <button
                    disabled={busy || !exportAllowed}
                    onClick={() => void perform(() => openEditor(part))}
                  >
                    {text.edit}
                  </button>
                </div>
              </article>
            ))}
          </section>
          <footer>
            <p>{text.local}</p>
            <p class="hint">{text.retained}</p>
            <button
              class="delete"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await deleteCaptureBundle(bundle.id);
                  setDeleted(true);
                  setBundle(null);
                  setStatus('');
                })
              }
            >
              {text.erase}
            </button>
            <p class="hint">{text.eraseHint}</p>
          </footer>
        </>
      )}
      <div class="live-status" role="status" aria-live="polite">
        {busy && !status ? text.wait : status}
      </div>
      {error && (
        <div class="notice warning" role="alert">
          {error}
        </div>
      )}
      {bundle && showNameDialog && (
        <ExportNameDialog
          initialName={
            bundle.exportName ??
            suggestExportName(bundle.title, fr ? 'capture-ecran' : 'screenshot')
          }
          onCancel={() => setShowNameDialog(false)}
          onConfirm={async (name) => {
            const updated = await setCaptureExportName(bundle.id, name);
            setBundle(updated);
            setShowNameDialog(false);
            setStatus(getMessage('exportNameSaved'));
          }}
        />
      )}
    </main>
  );
}

render(<App />, document.getElementById('app')!);
