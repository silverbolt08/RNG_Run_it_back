import { and, eq, isNotNull } from 'drizzle-orm';
import type { Clock } from '../../../lib/clock';
import type { DocumentStorage } from '../../adapters/storage/document-storage';
import type { Database } from '../../db/client';
import { recordAudit } from '../../db/repositories/audit-repository';
import { kycChecks, kycDocuments } from '../../db/schema';
import { updateApplication, type ApplicationRow } from './kyc-repository';

type Deps = { db: Database; clock: Clock; storage: DocumentStorage };

/** Deletes one kept file and notes it. Safe to call again if the file has already gone. */
export async function deleteDocumentFile(deps: Deps, documentId: string, storageKey: string): Promise<void> {
  await deps.storage.delete(storageKey);
  const now = deps.clock.now().toISOString();
  await deps.db
    .update(kycDocuments)
    .set({ storageKey: null, fileDeletedAt: now, updatedAt: now })
    .where(eq(kycDocuments.id, documentId));
}

/** Deletes every kept image for an application. The extracted fields stay. */
export async function deleteRawFiles(deps: Deps, applicationId: string): Promise<number> {
  const documents = await deps.db
    .select({ id: kycDocuments.id, storageKey: kycDocuments.storageKey })
    .from(kycDocuments)
    .where(and(eq(kycDocuments.applicationId, applicationId), isNotNull(kycDocuments.storageKey)));

  for (const document of documents) {
    if (document.storageKey) await deleteDocumentFile(deps, document.id, document.storageKey);
  }
  if (documents.length > 0) {
    await recordAudit(deps, {
      actorRef: 'system',
      action: 'DOCUMENT_FILES_DELETED',
      objectType: 'kyc_application',
      objectId: applicationId,
      metadata: { count: documents.length },
    });
  }
  return documents.length;
}

/**
 * Erases what an application holds. The row itself stays as a tombstone, so an order can still
 * name which application it came from, and audit records still point at something.
 */
export async function eraseApplication(deps: Deps, row: ApplicationRow): Promise<number> {
  const deleted = await deleteRawFiles(deps, row.id);
  await deps.db.delete(kycChecks).where(eq(kycChecks.applicationId, row.id));
  await deps.db.delete(kycDocuments).where(eq(kycDocuments.applicationId, row.id));
  await updateApplication(deps, row.id, {
    status: 'ERASED',
    verdict: null,
    sealedIdentity: null,
    contactNameSource: null,
    quoteChange: null,
    gstinConfirmed: 0,
    verifiedAt: null,
    erasedAt: deps.clock.now().toISOString(),
  });
  await recordAudit(deps, {
    actorRef: 'system',
    action: 'KYC_APPLICATION_ERASED',
    objectType: 'kyc_application',
    objectId: row.id,
    metadata: { documentsDeleted: deleted },
  });
  return deleted;
}
