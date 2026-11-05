'use client';

import { Camera, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Badge, Notice, type Tone } from '@/components/ui/feedback';
import { Card } from '@/components/ui/layout';
import { useLocale } from '@/i18n/locale-provider';
import { api, ApiFailure, newIdempotencyKey } from '@/lib/api-client';
import type { DocumentView, KycApplicationView } from '@/server/services/kyc/kyc-view';
import { useErrorMessage } from '../shell/use-error-message';

const UPLOAD_ERRORS = new Set(['UNSUPPORTED_FILE_TYPE', 'PDF_NOT_SUPPORTED', 'FILE_TOO_LARGE', 'IMAGE_TOO_LARGE', 'IMAGE_TOO_SMALL', 'UNREADABLE_IMAGE']);

const STATUS_TONE: Readonly<Record<string, Tone>> = {
  OK: 'success',
  BLURRED: 'danger',
  UNREADABLE: 'danger',
  WRONG_TYPE: 'danger',
  PENDING_READ: 'neutral',
};

type UploadResponse = { application: KycApplicationView };

export function UploadTile({
  applicationId,
  documentType,
  document,
  onUploaded,
}: {
  applicationId: string;
  documentType: string;
  document: DocumentView | undefined;
  onUploaded(application: KycApplicationView): void;
}) {
  const { t, tDynamic } = useLocale();
  const errorMessage = useErrorMessage();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept across a failed try, so a retry of the same file can't be stored twice.
  const attempt = useRef<{ key: string; file: File } | null>(null);

  const label = tDynamic(`kyc.doc.${documentType}`);

  const upload = async (file: File) => {
    if (attempt.current?.file !== file) attempt.current = { key: newIdempotencyKey(), file };
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('documentType', documentType);
      form.set('file', file);
      const { application } = await api.upload<UploadResponse>(`/kyc-applications/${applicationId}/documents`, form, attempt.current.key);
      attempt.current = null;
      onUploaded(application);
    } catch (caught) {
      const known = caught instanceof ApiFailure && UPLOAD_ERRORS.has(caught.code);
      setError(known ? tDynamic(`kyc.uploadError.${(caught as ApiFailure).code}`) : errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void upload(file);
  };

  const done = document?.quality === 'OK';

  return (
    <Card className="flex flex-col gap-2" selected={false}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{label}</span>
          <span className="text-sm text-ink-muted">{tDynamic(`kyc.docHint.${documentType}`)}</span>
        </div>
        {done ? <CheckCircle2 aria-hidden className="size-6 shrink-0 text-success" /> : null}
      </div>

      {document ? (
        <div aria-live="polite">
          <Badge tone={STATUS_TONE[document.quality] ?? 'neutral'}>
            {document.quality === 'WRONG_TYPE' && document.detectedType
              ? t('kyc.wrongTypeFound', { found: tDynamic(`kyc.doc.${document.detectedType}`), wanted: label })
              : tDynamic(`kyc.docStatus.${document.quality}`)}
          </Badge>
        </div>
      ) : null}

      {error ? <Notice tone="danger" live>{error}</Notice> : null}

      <label
        htmlFor={inputId}
        className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control border px-4 py-2 text-center font-medium ${busy ? 'cursor-wait opacity-60' : ''} ${done ? 'border-line-strong' : 'border-ink bg-ink text-surface'}`}
      >
        {busy ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : <Camera aria-hidden className="size-5" />}
        {busy ? t('kyc.uploading') : document ? t('kyc.replace') : t('kyc.upload', { document: label })}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png"
        disabled={busy}
        onChange={onChange}
        data-testid={`upload-${documentType}`}
        className="sr-only"
        aria-label={t('kyc.upload', { document: label })}
      />
    </Card>
  );
}
