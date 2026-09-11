import { initializeI18n } from '../shared/i18n';

void initializeI18n().then(async () => {
  document.title = 'OpenScreenShot Local';
  await import('./main');
});
