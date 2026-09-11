/**
 * Capture warnings are stored verbatim with a bundle, including captures made
 * before a language preference existed. Translate our known messages only at
 * the display boundary, leaving page content and browser diagnostics intact.
 * This pure lookup performs no network requests and does not rewrite storage.
 */
const FRENCH_CAPTURE_MESSAGES: Readonly<Record<string, string>> = {
  'The capture is too wide. Make the browser window narrower and retry.':
    'La capture est trop large. Réduisez la largeur de la fenêtre du navigateur, puis réessayez.',
  'The browser could not create this image section.':
    'Le navigateur n’a pas pu créer cette section d’image.',
  'Some visible images were still loading when their wait expired. Increase the image wait and retry if needed.':
    'Certaines images visibles étaient encore en cours de chargement à la fin du délai. Augmentez le délai d’attente des images et réessayez au besoin.',
  'Some visible images failed to load on the website.':
    'Certaines images visibles n’ont pas pu être chargées par le site Web.',
  'The page became shorter during capture. Saved sections reflect the content visible before that change; retry once the page has settled.':
    'La page a raccourci pendant la capture. Les sections enregistrées montrent le contenu visible avant ce changement. Réessayez une fois la page stabilisée.',
  'The top of this scroll container is outside the visible browser area. Only its visible content was captured.':
    'Le haut de cette zone de défilement se trouve hors de la partie visible du navigateur. Seul son contenu visible a été capturé.',
  'Capture stopped with Escape. Saved content is preserved.':
    'La capture a été arrêtée avec la touche Échap. Le contenu enregistré est conservé.',
  'The browser size, zoom, or scroll container changed during capture. Retry with a stable layout.':
    'La taille du navigateur, le zoom ou la zone de défilement a changé pendant la capture. Réessayez sans modifier la mise en page.',
  'The page jumped past uncaptured content. Saved sections stop before that gap.':
    'La page a défilé au-delà d’une partie du contenu qui n’a pas été capturée. Les sections enregistrées s’arrêtent avant cette partie manquante.',
  'The page stopped scrolling before its reported end. Only the content reached is included.':
    'Le défilement s’est arrêté avant la fin indiquée par la page. Seul le contenu atteint est inclus.',
  'The end of this scroll container is clipped outside the visible browser area.':
    'La fin de cette zone de défilement se trouve hors de la partie visible du navigateur.',
  'Capture stopped at its safety limit (2,000 views or 30 minutes). This may be an infinite page; earlier sections are preserved.':
    'La capture a atteint sa limite de sécurité (2 000 vues ou 30 minutes). Il peut s’agir d’une page à défilement infini. Les sections précédentes sont conservées.',
  'Capture was interrupted. Earlier sections are preserved.':
    'La capture a été interrompue. Les sections précédentes sont conservées.',
  'The final section could not be saved.': 'La dernière section n’a pas pu être enregistrée.',
  'Capture stopped before any image could be saved.':
    'La capture s’est arrêtée avant qu’une image puisse être enregistrée.',
  'Capture stopped because you switched tabs. Keep the source tab active while capturing.':
    'La capture s’est arrêtée parce que vous avez changé d’onglet. Gardez l’onglet source actif pendant la capture.',
  'No capture sections were saved.': 'Aucune section de la capture n’a été enregistrée.',
  'executeScript returned no result':
    'Le navigateur n’a renvoyé aucun résultat pour cette étape de la capture.',
  'The page replaced its scrolling region. Please capture again.':
    'La page a remplacé sa zone de défilement. Veuillez relancer la capture.',
  'Capture page stopped painting':
    'La page a cessé de mettre à jour son affichage pendant la capture.',
  'Capture tiles must be local PNG images.':
    'Les images à assembler doivent être des fichiers PNG locaux.',
  'The source screenshot exceeds the supported image size.':
    'La capture source dépasse la taille d’image prise en charge.',
  'The source screenshot has invalid PNG data.':
    'La capture source contient des données PNG non valides.',
  'The source screenshot exceeds the supported image dimensions.':
    'La capture source dépasse les dimensions d’image prises en charge.',
  'The image section exceeds the supported canvas dimensions.':
    'Cette section d’image dépasse les dimensions prises en charge pour l’assemblage.',
  'No captured tiles are available for this section.':
    'Aucune image capturée n’est disponible pour assembler cette section.',
  'The screenshot crop is invalid.': 'Le recadrage de la capture n’est pas valide.',
  'This browser does not support local background image processing.':
    'Ce navigateur ne prend pas en charge le traitement local des images en arrière-plan.',
  'The browser could not create the screenshot canvas.':
    'Le navigateur n’a pas pu créer la surface d’assemblage de la capture.',
  'The screenshot tile position is invalid.':
    'La position d’une image dans l’assemblage de la capture n’est pas valide.',
  'The scrolling region extends outside its captured screenshot.':
    'La zone de défilement dépasse les limites de l’image capturée.',
  'The screenshot is narrower than the image section.':
    'L’image capturée est moins large que la section à assembler.',
  'The browser could not export the screenshot section.':
    'Le navigateur n’a pas pu exporter cette section de la capture.',
  'Capture section must be a local PNG image.':
    'La section de capture doit être une image PNG locale.',
  'Invalid capture section dimensions.':
    'Les dimensions de la section de capture ne sont pas valides.',
  'The local capture is no longer available.': 'La capture locale n’est plus disponible.',
  'This capture is already finished.': 'Cette capture est déjà terminée.',
  'Capture sections must have the same width and join without gaps.':
    'Les sections de la capture doivent avoir la même largeur et se rejoindre sans espace.',
  'The capture reached its 256 MiB local storage limit. Earlier sections have been preserved.':
    'La capture a atteint sa limite de stockage local de 256 Mio. Les sections précédentes ont été conservées.',
  'Only saved sections are included; the capture height changed before completion.':
    'Seules les sections enregistrées sont incluses. La hauteur de la capture a changé avant la fin.',
  'This saved capture section is no longer available.':
    'Cette section enregistrée de la capture n’est plus disponible.',
  'Invalid local capture image.': 'L’image de la capture locale n’est pas valide.',
  'Canvas 2D context unavailable': 'Le navigateur n’a pas pu créer la surface de dessin 2D.',
  'canvas 2d context unavailable': 'Le navigateur n’a pas pu créer la surface de dessin 2D.',
  '2d context unavailable': 'Le navigateur n’a pas pu créer la surface de dessin 2D.',
  'A saved capture section is missing.': 'Une section enregistrée de la capture est manquante.',
  'Saved image dimensions do not match the capture.':
    'Les dimensions de l’image enregistrée ne correspondent pas à celles de la capture.',
  'The saved capture has a gap between sections.':
    'La capture enregistrée contient un espace entre ses sections.',
  'PDF export needs at least one page.': 'L’exportation PDF nécessite au moins une page.',
  'PDF page count changed during export.':
    'Le nombre de pages du PDF a changé pendant l’exportation.',
  'tile load failed': 'Une image de la capture n’a pas pu être chargée.',
  'Could not open this capture.': 'Impossible d’ouvrir cette capture.',
};

export function translateCaptureMessage(message: string, language: string): string {
  if (!/^fr(?:[-_]|$)/i.test(language)) return message;
  // An own-property lookup also preserves arbitrary browser diagnostics such
  // as "constructor" or "toString", rather than reading Object.prototype.
  return Object.prototype.hasOwnProperty.call(FRENCH_CAPTURE_MESSAGES, message)
    ? FRENCH_CAPTURE_MESSAGES[message]
    : message;
}
