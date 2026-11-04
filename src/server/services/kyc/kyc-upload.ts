import { and, eq, isNull } from 'drizzle-orm';
import {
  assessImageQuality,
  detectDocumentType,
  parseAddressProof,
  parseGstCertificate,
  parseSignatoryId,
  parseUdyamCertificate,
  type DocumentType,
} from '../../../domain/kyc/documents';
import { newPublicId } from '../../../lib/ids';
import { blurScore } from '../../adapters/images/blur-score';
import { OcrUnavailableError, type OcrResult } from '../../adapters/ocr/ocr-provider';
import { MAX_UPLOAD_BYTES, UploadRejectedError, validateUpload } from '../../adapters/images/upload-validation';
import type { AppContext } from '../../app-context';
import { recordAudit } from '../../db/repositories/audit-repository';
import { kycDocuments } from '../../db/schema';
import { ApiError, invalidRequest } from '../../http/errors';
import { documentTypeSchema } from '../../http/schemas';
import { completeKey, hashRequest, releaseKey, reserveKey } from '../idempotency';
import { assessApplication } from './kyc-assessment';
import { deleteDocumentFile } from './kyc-erasure';
import {
  fieldsContext,
  listActiveDocuments,
  loadApplication,
  updateApplication,
  type ApplicationRow,
  type DocumentRow,
} from './kyc-repository';
import { toApplicationView, toDocumentView, type DocumentView, type KycApplicationView } from './kyc-view';

// Room for the multipart boundaries and the other form field around a 10 MB file.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const ALLOWED_FORM_FIELDS: ReadonlySet<string> = new Set(['file', 'documentType']);

const PARSERS: Readonly<Record<DocumentType, (text: string) => unknown>> = {
  GST_CERTIFICATE: parseGstCertificate,
  UDYAM_CERTIFICATE: parseUdyamCertificate,
  SIGNATORY_ID: parseSignatoryId,
  ADDRESS_PROOF: parseAddressProof,
};

type ReadDocument = {
  quality: 'OK' | 'BLURRED' | 'UNREADABLE' | 'WRONG_TYPE' | 'PENDING_READ';
  detectedType: DocumentType | null;
  fields: unknown;
  /** Only a readable document of the right type is worth keeping. */
  image: Buffer | null;
  blurScore: number;
  ocrConfidence: number | null;
  rotationDegrees: number | null;
};

export type UploadResult = {
  created: boolean;
  replayed: boolean;
  document: DocumentView | null;
  application: KycApplicationView;
};

/** Reads no more than the limit, so an oversized body can't fill memory before it is rejected. */
async function readLimitedBody(request: Request): Promise<Buffer> {
  const limit = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) throw new UploadRejectedError('FILE_TOO_LARGE');

  const reader = request.body?.getReader();
  if (!reader) throw invalidRequest([{ path: 'file', code: 'required' }]);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new UploadRejectedError('FILE_TOO_LARGE');
    }
    chunks.push(value);
  }
}

async function readUploadForm(request: Request): Promise<{ documentType: DocumentType; bytes: Buffer }> {
  const body = await readLimitedBody(request);
  const contentType = request.headers.get('content-type') ?? '';

  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw invalidRequest([{ path: 'file', code: 'required' }]);
  }

  for (const key of form.keys()) {
    if (!ALLOWED_FORM_FIELDS.has(key)) throw invalidRequest([{ path: key, code: 'unrecognized_keys' }]);
  }
  const type = documentTypeSchema.safeParse(form.get('documentType'));
  if (!type.success) throw invalidRequest([{ path: 'documentType', code: 'invalid_value' }]);

  const file = form.get('file');
  if (!(file instanceof File)) throw invalidRequest([{ path: 'file', code: 'required' }]);
  return { documentType: type.data, bytes: Buffer.from(await file.arrayBuffer()) };
}

/** Quality gate, then OCR, then parse. A blurred image never reaches OCR, and values aren't guessed. */
async function readDocument(app: AppContext, documentType: DocumentType, bytes: Buffer): Promise<ReadDocument> {
  const { image } = await validateUpload(bytes);
  const score = await blurScore(image);
  const none = { detectedType: null, fields: null, image: null, ocrConfidence: null, rotationDegrees: null };

  if (assessImageQuality(score) === 'BLURRED') return { ...none, quality: 'BLURRED', blurScore: score };

  const read = await readWithOcr(app, documentType, image, score);
  // The owner's upload survives an OCR outage. It stays encrypted until OCR can read it.
  return read ?? { ...none, quality: 'PENDING_READ', image, blurScore: score };
}

/** Returns null during an OCR outage. OCR text stops here: only parsed fields go on, sealed. */
async function readWithOcr(
  app: AppContext,
  documentType: DocumentType,
  image: Buffer,
  score: number,
): Promise<ReadDocument | null> {
  let ocr: OcrResult;
  try {
    ocr = await app.ocr.read(image);
  } catch (error) {
    if (!(error instanceof OcrUnavailableError)) throw error;
    app.logger.error('ocr.unavailable', { error });
    return null;
  }

  const none = { detectedType: null, fields: null, image: null };
  const read = { ocrConfidence: ocr.confidence, rotationDegrees: ocr.rotationDegrees, blurScore: score };
  const detected = detectDocumentType(ocr.text);

  if (detected === documentType) {
    return { quality: 'OK', detectedType: detected, fields: PARSERS[documentType](ocr.text), image, ...read };
  }
  if (ocr.text.trim() === '') return { ...none, ...read, quality: 'UNREADABLE' };
  return { ...none, ...read, quality: 'WRONG_TYPE', detectedType: detected };
}

/** Reads what was kept during an outage. Stops at the first failure, since OCR must still be down. */
export async function readPendingDocuments(app: AppContext, applicationId: string): Promise<void> {
  const documents = await listActiveDocuments(app, applicationId);
  for (const document of documents) {
    if (document.quality !== 'PENDING_READ' || !document.storageKey) continue;

    const image = await app.storage.get(document.storageKey);
    const read = await readWithOcr(app, document.documentType as DocumentType, image, document.blurScore ?? 0);
    if (!read) return;

    await app.db
      .update(kycDocuments)
      .set({
        quality: read.quality,
        detectedType: read.detectedType,
        sealedFields: read.fields === null ? null : app.sealer.sealJson(read.fields, fieldsContext(document.id)),
        ocrConfidence: read.ocrConfidence,
        rotationDegrees: read.rotationDegrees,
        storageKey: read.image ? document.storageKey : null,
        updatedAt: app.clock.now().toISOString(),
      })
      .where(eq(kycDocuments.id, document.id));
    if (!read.image) await app.storage.delete(document.storageKey);
  }
}

async function storeDocument(
  app: AppContext,
  application: ApplicationRow,
  documentType: DocumentType,
  read: ReadDocument,
): Promise<DocumentRow> {
  const now = app.clock.now().toISOString();
  const id = newPublicId('doc');
  const storageKey = read.image ? await app.storage.put(read.image) : null;

  // The old document goes when the new one is safely stored, so a failure can't lose the only copy.
  const previous = await app.db
    .select({ id: kycDocuments.id, storageKey: kycDocuments.storageKey })
    .from(kycDocuments)
    .where(
      and(
        eq(kycDocuments.applicationId, application.id),
        eq(kycDocuments.documentType, documentType),
        isNull(kycDocuments.supersededAt),
      ),
    );

  const [row] = await app.db
    .insert(kycDocuments)
    .values({
      id,
      applicationId: application.id,
      documentType,
      quality: read.quality,
      detectedType: read.detectedType,
      sealedFields: read.fields === null ? null : app.sealer.sealJson(read.fields, fieldsContext(id)),
      storageKey,
      ocrConfidence: read.ocrConfidence,
      blurScore: read.blurScore,
      rotationDegrees: read.rotationDegrees,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Inserting a document returned no row');

  for (const old of previous) {
    await app.db
      .update(kycDocuments)
      .set({ supersededAt: now, sealedFields: null, updatedAt: now })
      .where(eq(kycDocuments.id, old.id));
    if (old.storageKey) await deleteDocumentFile(app, old.id, old.storageKey);
  }
  return row;
}

export async function uploadDocument(
  app: AppContext,
  input: { ownerId: string; subjectRef: string; applicationId: string; idempotencyKey: string; request: Request; requestId: string },
): Promise<UploadResult> {
  const application = await loadApplication(app, input.ownerId, input.applicationId);
  if (application.status !== 'OPEN') throw new ApiError(409, 'APPLICATION_CLOSED', 'This application is closed.');

  const { documentType, bytes } = await readUploadForm(input.request);
  const reservation = await reserveKey(
    app,
    input.ownerId,
    'DOCUMENT_UPLOAD',
    input.idempotencyKey,
    hashRequest(application.id, documentType, bytes),
  );

  if ('replayOf' in reservation) {
    const documents = await listActiveDocuments(app, application.id);
    const document = documents.find((doc) => doc.id === reservation.replayOf);
    return {
      created: false,
      replayed: true,
      document: document ? toDocumentView(document) : null,
      application: await toApplicationView(app, application),
    };
  }

  let document: DocumentRow;
  try {
    const read = await readDocument(app, documentType, bytes);
    document = await storeDocument(app, application, documentType, read);
    await completeKey(app, reservation.reservationId, document.id);
  } catch (error) {
    await releaseKey(app, reservation.reservationId);
    throw error;
  }

  await recordAudit(app, {
    actorRef: input.subjectRef,
    action: 'DOCUMENT_UPLOADED',
    objectType: 'kyc_document',
    objectId: document.id,
    requestId: input.requestId,
    metadata: { documentType, quality: document.quality },
  });
  app.logger.info('kyc.document', { requestId: input.requestId, documentType, quality: document.quality });

  // A new certificate replaces any number the owner confirmed against the old one.
  const fresh =
    documentType === 'GST_CERTIFICATE' && application.gstinConfirmed === 1
      ? await updateApplication(app, application.id, { gstinConfirmed: 0 })
      : application;
  await readPendingDocuments(app, application.id);
  const assessed = await assessApplication(app, fresh, input.requestId);

  return {
    created: true,
    replayed: false,
    document: toDocumentView(document),
    application: await toApplicationView(app, assessed),
  };
}
