import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ExportNameError, normalizeExportName, validateExportName } from './export-name';
import { getMessage } from './i18n';
import './export-name-dialog.css';

export interface ExportNameDialogProps {
  /** An existing canonical basename or a safe suggestion from suggestExportName. */
  initialName: string;
  onConfirm: (name: string) => Promise<void> | void;
  onCancel: () => void;
}

/** Native modal behavior contains focus and makes the background inaccessible. */
export function ExportNameDialog({ initialName, onConfirm, onCancel }: ExportNameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  let preview = '';
  try {
    preview = name === initialName ? validateExportName(name) : normalizeExportName(name);
  } catch {
    // Invalid input is reported on confirmation, without announcing every keystroke.
  }

  async function confirm() {
    if (submitting.current) return;
    setError('');
    let normalized: string;
    try {
      normalized = name === initialName ? validateExportName(name) : normalizeExportName(name);
    } catch (err) {
      setError(
        getMessage(err instanceof ExportNameError ? err.messageKey : 'exportNameErrorUnknown'),
      );
      inputRef.current?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await onConfirm(normalized);
    } catch (err) {
      setError(
        getMessage(err instanceof ExportNameError ? err.messageKey : 'exportNameErrorUnknown'),
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="export-name-dialog"
      aria-labelledby="export-name-title"
      aria-describedby="export-name-hint"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current) onCancel();
      }}
    >
      <form
        aria-busy={saving}
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <h2 id="export-name-title">{getMessage('exportNameTitle')}</h2>
        <p id="export-name-hint" class="export-name-hint">
          {getMessage('exportNameHint')}
        </p>
        <label for="export-name-input">{getMessage('exportNameLabel')}</label>
        <input
          ref={inputRef}
          id="export-name-input"
          type="text"
          value={name}
          maxLength={240}
          autoFocus
          autoComplete="off"
          spellcheck={false}
          disabled={saving}
          aria-invalid={!!error}
          aria-describedby={error ? 'export-name-hint export-name-error' : 'export-name-hint'}
          onInput={(event) => {
            setName(event.currentTarget.value);
            setError('');
          }}
        />
        {preview && (
          <p class="export-name-preview">
            <span>{getMessage('exportNameWatermarkPreview')}</span>
            <strong>{preview}</strong>
          </p>
        )}
        {error && (
          <p id="export-name-error" class="export-name-error" role="alert">
            {error}
          </p>
        )}
        <div class="export-name-actions">
          <button type="button" disabled={saving} onClick={onCancel}>
            {getMessage('exportNameCancel')}
          </button>
          <button type="submit" class="export-name-confirm" disabled={saving}>
            {getMessage('exportNameConfirm')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
