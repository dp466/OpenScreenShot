/** Shared message lookup for the screenshot editor. */
import { getMessage } from '../shared/i18n';

export function t(id: string, subs?: string | string[]): string {
  return getMessage(id, subs) || id;
}
