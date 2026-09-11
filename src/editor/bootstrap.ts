import { getMessage, initializeI18n } from '../shared/i18n';

void initializeI18n().then(async () => {
  document.title = getMessage('editorPageTitle') || 'OpenScreenShot Local';
  await import('./main');
});
