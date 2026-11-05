import type { Blocker } from '@/domain/eligibility/eligibility';
import type { MessageParams } from '@/i18n/messages';

type Translate = (key: string, params?: MessageParams) => string;

/** Blockers carry values rather than sentences, so each language words them here. */
export function blockerText(t: Translate, blocker: Blocker, names: Readonly<Record<string, string>>): string {
  switch (blocker.rule) {
    case 'MIN_EMPLOYEES':
    case 'MIN_SITES':
      return t(`blocker.${blocker.rule}`, { required: blocker.required });
    case 'DEPENDENCY': {
      const known = blocker.required.map((id) => names[id]).filter(Boolean);
      return known.length > 0 ? t('blocker.DEPENDENCY', { names: known.join(', ') }) : t('blocker.DEPENDENCY_NONE');
    }
    default:
      return t(`blocker.${blocker.rule}`);
  }
}
