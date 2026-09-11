# OpenScreenShot Local 2.1.3 — Français / English

Custom, unofficial build based on OpenScreenShot commit
`16ed3c5f15f93ed15dff639cc2ee7908797df101` (upstream version 2.1.0).
Upstream source: https://github.com/pghqdev/OpenScreenShot
The MIT license and upstream attribution are retained.

## Mise à jour depuis la version 2.1.2

1. Extrayez le nouveau ZIP.
2. Remplacez le contenu du dossier **extension déjà chargé dans Chrome** par le contenu du nouveau dossier **extension**, en conservant le même emplacement.
3. Dans `chrome://extensions` (ou `edge://extensions`), cliquez sur **Actualiser / Recharger** sur la carte OpenScreenShot Local. Ne désinstallez pas l’extension : conserver son dossier et son identité conserve ses captures et réglages locaux.
4. Le français est sélectionné par défaut. Le menu contextuel de l’icône donne accès à **Paramètres → Apparence → Langue de l’interface**. Vous pouvez choisir **Français**, **English** ou **Langue du navigateur**.

La préférence est enregistrée uniquement dans le stockage local de l’extension. Un changement explicite recharge seulement la page des paramètres. Les pages de capture ou d’édition déjà ouvertes conservent leur travail; la nouvelle langue s’applique à leur prochaine ouverture. Les écrans appartenant à Chrome, comme la gestion des raccourcis et les dialogues d’enregistrement, gardent la langue de Chrome ou du système.

Cette mise à jour traduit les menus, boutons de capture de zone, écrans de résultats, avertissements connus, éditeur et commandes d’enregistrement. Les titres des pages capturées et le contenu des captures ne sont pas traduits. Les messages techniques inconnus fournis par le navigateur restent intacts.

## Upgrade from 2.1.2

Replace the contents of the **existing loaded extension folder** with the new `extension` folder contents, keeping the same folder path. Click **Reload** on its `chrome://extensions` card. Do not uninstall it or load it from a new location if you want to retain its existing local captures and settings.

French is the default. Use **Settings → Appearance → Interface language** to choose French, English, or the browser language. The selected language is stored locally. Existing editor/result tabs retain their current work and use the new language on their next opening. Native browser screens and save dialogs follow Chrome/the operating system.

## Nouveau : nom de fichier et filigrane facultatif

Dans **Paramètres**, activez **Demander un nom de fichier et ajouter un filigrane à chaque page**, sous les réglages de capture. Cette option est **désactivée par défaut** et s’applique aux prochaines captures, y compris les captures de zone et de partie visible.

À la fin de la capture, une boîte de dialogue propose un nom modifiable. Cliquez sur **Utiliser ce nom**, puis enregistrez le PDF ou les PNG depuis les résultats. Le nom choisi apparaît en bas à droite de **chaque page PDF**, même la dernière page courte, et de **chaque section PNG**. Le filigrane utilise un texte sombre sur un fond blanc translucide. Les accents français sont conservés; les noms longs peuvent occuper deux lignes.

Par exemple, `Dossier Québec 2026` donne `Dossier Québec 2026.pdf` ou `Dossier Québec 2026_part-001.png`, `Dossier Québec 2026_part-002.png`, etc. Le filigrane affiche toujours `Dossier Québec 2026`, sans suffixe de section ni extension ajoutée.

**Annuler** conserve la capture localement. **Nommer cette capture** permet de reprendre; **Modifier le nom du fichier** permet ensuite de renommer. Les originaux restent sans filigrane : celui-ci est ajouté aux copies exportées. Une section ouverte dans l’éditeur conserve le nom pour ses exports PNG, JPEG, WebP, PDF et pour la copie d’image. Le filigrane est ajouté après les modifications et le redimensionnement; l’aperçu de travail conserve les pixels originaux.

Le réglage est mémorisé avec chaque capture. Le désactiver concerne les nouvelles captures; les résultats déjà ouverts conservent leur choix. Si une action rapide de copie ou d’enregistrement était sélectionnée, le nom est demandé avant tout export. Le dialogue du navigateur peut ensuite demander où enregistrer le fichier. Renommer un fichier dans ce dialogue ou dans l’explorateur ne modifie pas un filigrane déjà généré : utilisez **Modifier le nom du fichier** avant l’export pour garder les deux identiques.

## New: optional filename prompt and watermark

In **Settings**, enable **Ask for a filename and watermark each page**. It is **off by default** and applies to new full-page, visible-area, and region captures. When capture finishes, choose a name, confirm it, then save the PDF or PNG sections from the results. The same base name is stamped at the bottom-right of every physical PDF page and every PNG section. PNG filenames add `_part-001`, `_part-002`, and so on; their watermark uses the shared base name.

Cancelling preserves the capture and lets you return to naming later. You can edit the name before exporting again. Original pixels remain unstamped in local storage, so renaming never stacks watermarks. Editor exports and image copying retain the capture’s chosen watermark, including after cropping, resizing, or PDF pagination. Working previews show the editable original. The option is saved with each capture; switching it off affects new captures. When enabled, it takes precedence over quick-copy/quick-save actions so export cannot occur before naming. Renaming in the browser’s save dialog or file manager does not change an already rendered watermark; edit the name in the extension before export instead.

## Install the ready-to-use extension

1. Extract this ZIP into a permanent local folder.
2. In Chrome open `chrome://extensions`. In Edge use `edge://extensions`.
3. Temporarily disable your existing OpenScreenShot extension so its icon and keyboard shortcuts do not conflict with this build.
4. Enable **Developer mode**, choose **Load unpacked**, and select the extracted **extension** folder. Select the folder containing `manifest.json`, not the outer package or the `source` folder.
5. Pin **OpenScreenShot Local** to the toolbar.
6. Right-click its toolbar icon and choose **Settings**. Set **Pause after each scroll**, **Wait for visible images**, and **Maximum extra image wait**. Leave **Long-page export** on PDF, or choose PNG sections.
7. Return to the page to capture, keep that tab active, leave zoom at 100%, and click the extension icon. If you disabled **Icon click captures the full page**, choose **Full page** from its popup instead.
8. Long captures open a results tab. Choose **Save one PDF**, **Save all PNGs**, or save individual sections. Select a local folder that is not synchronized by OneDrive, iCloud, Dropbox, or another backup/sync service.

The unpacked build is separate from the store version. It does not modify the installed store extension or receive store updates. Keep the extracted folder in place. To update a later custom build, replace its files and press **Reload** on its extensions-page card.

## What changed

- Every scroll is followed by an adjustable **0.5–10 second pause**, default **1.5 seconds**, before a screenshot. This is separate from the existing initial countdown.
- **Wait for visible images** is enabled by default. The extension waits for visible HTML images to finish loading and decoding, for up to **10 extra seconds** by default; this can be set from **1–30 seconds**. Images that fail or exceed the wait produce a warning in the results. The maximum is a timeout, not an extra fixed delay for every image.
- The next position comes from the actual scroll offset and current page height. Views overlap by 10%. The end is rechecked after a settled wait, without duplicating a screenshot when the page cannot move farther. Only reached rows are saved. A shrinking or changing page is marked partial rather than silently described as complete.
- Long pages are saved at the capture's resolution in contiguous PNG sections. Each canvas is at most **16,000 pixels high** and **32 million pixels** in area. This removes the old single-canvas total-height check; there is no 117,812px total-page threshold in this capture path.
- A long capture can be exported as **one multipage PDF** or separate full-resolution PNGs. The PDF preserves image pixels and paginates them onto A4 pages. It is a raster capture, without OCR or selectable page text. It decodes one section and encodes one bounded page at a time; compressed bytes for the completed PDF still accumulate in memory.
- Press **Escape** to stop. Captured content is saved as an explicitly partial result. Switching tabs, a stalled scroller, a changed layout, or closing the source tab also preserves available captured content. The active target is checked before and after screenshots; a screenshot taken during a tab switch is discarded.
- Sections are combined in the extension's background worker, so the source tab does not need to remain open to save already captured pixels. Original page scroll position and styles are restored where the page remains available.
- Saved long captures are accessible under **Recent long captures** in the popup. If icon clicks capture immediately, turn off **Icon click captures the full page** to open the picker/history. The new capture and three previous completed long captures are retained; unfinished captures are preserved. Download captures you want to keep.

## Practical limits

This is not an unlimited capture of an infinite feed. A job stops after 2,000 captured views or 30 minutes. Each long capture has a 256 MiB budget for encoded PNG data and thumbnails; earlier saved sections are retained if that limit is reached. Width is limited to 32,000 output pixels. Available memory, disk space, and browser behavior can impose lower limits.

HTML images are checked for loading and decode readiness. CSS background images, video, cross-origin embedded frames, and application-specific drawing have no equivalent general readiness signal here; increase the post-scroll pause if those paint slowly. Content that appears only after a click, hover, or very delayed infinite-feed update may need preparation before capture. Images that never load on the website cannot be recovered by waiting. The capture follows the main document or a dominant inner scroll area, not every independent scroll pane.

## Privacy and deletion

The new screenshot path uses local browser APIs, `chrome.storage.local`, local PNG data, and local blob downloads. It adds no upload service, remote processing, telemetry, or browser synchronization. Installation does not open the vendor welcome page, and the vendor uninstall destination is cleared. Fonts and runtime scripts are bundled locally. The upstream OpenScreenShot MIT licence, Preact MIT licence, Roboto OFL licence and Material Icons Apache licence are included inside `extension/licenses/`.

The visited website still makes its ordinary requests to load its content. Existing user-initiated upstream support, source, review, and donation links remain external links. The extension does not control operating-system backups or synchronization of the browser profile or downloaded files. Source URLs and page titles are retained alongside local captures.

**Delete this local capture** deletes its long-capture sections and metadata from the extension. Downloaded files and sections separately opened in the editor/capture history remain separate copies and must be deleted separately. Uninstalling this unpacked extension removes its extension storage; exported files remain on disk.

## Build from the included source

The ready-to-use `extension` folder needs no package installation. To rebuild the `source` folder with Node.js 22+ and npm:

```sh
npm ci
npm run icons
npm run build
```

Load the resulting `dist` folder as an unpacked extension. Installing build dependencies uses the package registry; capturing and exporting does not require a cloud service.

Relevant implementation files:

- `src/shared/capture-settings.ts`: timing bounds and defaults.
- `src/content/scroll-capture.ts`: scroll, image readiness, and page restoration.
- `src/background/full-page-session.ts`: actual-position loop, section coverage, and safety limits.
- `src/background/section-stitcher.ts`: bounded local image composition.
- `src/shared/capture-bundles.ts`: local persistence and retention.
- `src/capture-results/`: export, results, and recent-capture controls.

## Validation and remaining checks

The automated suite covers normal and clipped scrollers, image loading/decode waits, timeout and cancellation behavior, exact restoration, section boundaries, tab switching and closure, storage errors, PDF pagination, localization, and accessibility guards. A 180,125px page at normal scale is checked for continuous coverage across 12 sections. Integration tests also check an exact 117,812px page without zooming out.

This release is validated with the full automated suite, TypeScript, ESLint, formatting of changed files, and the production build. See BUILD-INFO.json in the delivered package for the exact test count. New tests cover the on/off capture routing, canonical filename validation, local name persistence, naming/history round trips, PDF page placement, long names, French accents, PNG resource cleanup, and editor resizing before watermarking. Actual two-page PDF and PNG outputs were generated with the export code using native canvas and visually inspected after Poppler rendering; the short final PDF page retained its watermark at the page bottom. This checks exported files, not live Chrome UI behavior. Browser preview navigation to the local test fixtures was rejected with `net::ERR_BLOCKED_BY_CLIENT` and a browser URL-policy denial. No live browser/installed-extension or site-specific visual test is claimed. The browser's installation flow, rendered settings/results, real download dialogs, and your particular website still need a local trial. Begin with a non-sensitive sample page and inspect the last section and image-heavy areas before relying on the result.
