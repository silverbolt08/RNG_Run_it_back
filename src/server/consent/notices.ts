import type { ConsentPurpose } from '../db/schema/enums';

/**
 * The current notice per purpose. The wording lives in the message catalogues. Bump a version
 * here when a notice's meaning changes: earlier consent then stops counting, and the owner is
 * asked again.
 */
export const CURRENT_NOTICE_VERSIONS: Readonly<Record<ConsentPurpose, string>> = {
  advisor_profile: '2026-11-v1',
  kyc_verification: '2026-11-v1',
  service_updates: '2026-11-v1',
  marketing: '2026-11-v1',
};
