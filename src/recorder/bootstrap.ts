import { getMessage, initializeI18n } from '../shared/i18n';

void initializeI18n().then(async () => {
  document.title = getMessage('recorderPageTitle') || 'OpenScreenShot Local';
  await import('./main');
});
