import { getMessage, initializeI18n } from '../shared/i18n';

void initializeI18n().then(async () => {
  document.title = getMessage('setupPageTitle') || 'OpenScreenShot Local';
  await import('./main');
});
