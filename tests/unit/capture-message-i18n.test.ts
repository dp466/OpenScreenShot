import { describe, expect, it } from 'vitest';
import { translateCaptureMessage } from '../../src/shared/capture-message-i18n';

describe('capture message display translations', () => {
  it('translates a stored image-loading warning without altering the stored value', () => {
    const bundle = {
      warnings: [
        'Some visible images were still loading when their wait expired. Increase the image wait and retry if needed.',
      ],
    };
    const stored = JSON.stringify(bundle);
    expect(bundle.warnings.map((message) => translateCaptureMessage(message, 'fr'))).toEqual([
      'Certaines images visibles étaient encore en cours de chargement à la fin du délai. Augmentez le délai d’attente des images et réessayez au besoin.',
    ]);
    expect(JSON.stringify(bundle)).toBe(stored);
  });

  it.each(['fr', 'fr-CA', 'fr-FR', 'fr_CA', 'FR-ca'])(
    'recognizes French locale %s for a capture interruption',
    (language) => {
      expect(
        translateCaptureMessage(
          'Capture stopped because you switched tabs. Keep the source tab active while capturing.',
          language,
        ),
      ).toBe(
        'La capture s’est arrêtée parce que vous avez changé d’onglet. Gardez l’onglet source actif pendant la capture.',
      );
    },
  );

  it.each([
    [
      'The capture reached its 256 MiB local storage limit. Earlier sections have been preserved.',
      'La capture a atteint sa limite de stockage local de 256 Mio. Les sections précédentes ont été conservées.',
    ],
    [
      'PDF page count changed during export.',
      'Le nombre de pages du PDF a changé pendant l’exportation.',
    ],
    [
      'This browser does not support local background image processing.',
      'Ce navigateur ne prend pas en charge le traitement local des images en arrière-plan.',
    ],
    [
      'The page replaced its scrolling region. Please capture again.',
      'La page a remplacé sa zone de défilement. Veuillez relancer la capture.',
    ],
    [
      'Only saved sections are included; the capture height changed before completion.',
      'Seules les sections enregistrées sont incluses. La hauteur de la capture a changé avant la fin.',
    ],
  ])('translates a known diagnostic: %s', (message, french) => {
    expect(translateCaptureMessage(message, 'fr')).toBe(french);
  });

  it.each(['en', 'en-CA', 'de', '', 'free'])('preserves English for locale %s', (language) => {
    const message = 'Capture stopped with Escape. Saved content is preserved.';
    expect(translateCaptureMessage(message, language)).toBe(message);
  });

  it.each([
    'No tab with id: 72.',
    'The message port closed before a response was received.',
    'Capture stopped with Escape. Saved content is preserved. Additional browser details.',
    'Données du client / customer data: Capture stopped with Escape. Saved content is preserved.',
    'constructor',
    'toString',
    '__proto__',
    '',
  ])('preserves an unknown browser or content message verbatim: %s', (message) => {
    expect(translateCaptureMessage(message, 'fr')).toBe(message);
  });
});
