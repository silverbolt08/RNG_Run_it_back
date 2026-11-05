'use client';

import { Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Notice, Skeleton } from '@/components/ui/feedback';
import { StickyBar } from '@/components/ui/layout';
import type { SlotAnswer } from '@/domain/advisor/slot-answers';
import { useLocale } from '@/i18n/locale-provider';
import { api, ApiFailure, ensureSession } from '@/lib/api-client';
import type { ConversationView, StoredMessage } from '@/server/services/advisor/advisor-service';
import { useErrorMessage } from '../shell/use-error-message';
import { BundleCard } from './bundle-card';
import { createQuoteFrom } from './create-quote';
import { SlotChoices } from './slot-choices';

function ChatBubble({ message }: { message: Pick<StoredMessage, 'role' | 'text'> }) {
  const mine = message.role === 'owner';
  return (
    <li className={`max-w-[85%] rounded-card px-3 py-2 ${mine ? 'self-end bg-ink text-surface' : 'self-start border border-line bg-surface-alt'}`}>
      {message.text}
    </li>
  );
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 self-start rounded-card border border-line bg-surface-alt px-3 py-2 text-sm text-ink-muted">
      <span aria-hidden className="size-2 animate-pulse rounded-pill bg-ink-muted" />
      {label}
    </li>
  );
}

export function AdvisorScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [view, setView] = useState<ConversationView | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [goingToQuote, setGoingToQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const start = useCallback(
    async (restart = false) => {
      await ensureSession();
      const conversation = await api.post<ConversationView>('/conversations', { language: locale, ...(restart ? { restart } : {}) });
      setView(conversation);
    },
    [locale],
  );

  // The language only picks the greeting of a new chat. An open chat stays as it is.
  const startOnce = useRef(start);
  useEffect(() => {
    startOnce.current().catch((caught: unknown) => {
      if (caught instanceof ApiFailure && caught.code === 'CONSENT_REQUIRED') router.replace('/');
      else setError(errorMessage(caught));
    });
  }, [errorMessage, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [view?.messages.length, pendingText]);

  const send = async (body: { text?: string; answer?: SlotAnswer }, shown: string) => {
    if (!view || busy) return;
    setBusy(true);
    setError(null);
    setPendingText(shown);
    try {
      setView(await api.post<ConversationView>(`/conversations/${view.id}/messages`, { ...body, language: locale }));
      setDraft('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      setPendingText(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text) void send({ text }, text);
  };

  const seeQuote = async () => {
    if (!view?.recommendation) return;
    setGoingToQuote(true);
    setError(null);
    try {
      await createQuoteFrom(view.recommendation);
      router.push('/quote');
    } catch (caught) {
      setError(errorMessage(caught));
      setGoingToQuote(false);
    }
  };

  const talkToPerson = async () => {
    if (!view) return;
    setBusy(true);
    try {
      setView(await api.post<ConversationView>(`/conversations/${view.id}/handoff`, { language: locale }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setBusy(true);
    start(true)
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setBusy(false));
  };

  if (!view) {
    return error ? <Notice tone="danger" live>{error}</Notice> : <Skeleton label={t('app.loading')} />;
  }

  const handedOff = view.status === 'HANDED_OFF';
  const canSeeQuote = !handedOff && (view.recommendation?.lines.length ?? 0) > 0;

  return (
    <div className="flex grow flex-col gap-3">
      <h1 className="sr-only">{t('advisor.title')}</h1>

      <ul aria-live="polite" aria-relevant="additions" className="flex grow flex-col gap-2">
        {view.messages.map((message, index) => (
          <ChatBubble key={index} message={message} />
        ))}
        {pendingText ? <ChatBubble message={{ role: 'owner', text: pendingText }} /> : null}
        {busy && pendingText ? <TypingIndicator label={t('advisor.typing')} /> : null}
      </ul>

      {view.recommendation ? <BundleCard recommendation={view.recommendation} /> : null}

      {view.recommendation && view.assistSuggested && !handedOff ? <Notice tone="neutral">{t('advisor.assistHint')}</Notice> : null}

      {handedOff ? (
        <Notice tone="success" title={t('advisor.handedOffTitle')}>
          {t('advisor.handedOffBody')}
        </Notice>
      ) : null}

      {!view.llmAvailable && !handedOff ? (
        <Notice tone="warning" live>
          {t('advisor.llmDown')}{' '}
          <Link href="/advisor/form" className="font-medium underline underline-offset-4">
            {t('advisor.useForm')}
          </Link>
        </Notice>
      ) : null}

      {error ? <Notice tone="danger" live>{error}</Notice> : null}
      <div ref={endRef} />

      <StickyBar>
        {handedOff ? (
          <Button fullWidth variant="secondary" disabled={busy} onClick={restart}>
            {t('advisor.startOver')}
          </Button>
        ) : (
          <>
            {view.askedSlot ? <SlotChoices slot={view.askedSlot} disabled={busy} onAnswer={(answer, label) => void send({ answer, text: label }, label)} /> : null}
            {canSeeQuote ? (
              <Button fullWidth loading={goingToQuote} onClick={() => void seeQuote()}>
                {t('advisor.seeBundle')}
              </Button>
            ) : null}
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <label htmlFor="advisor-input" className="sr-only">
                {t('advisor.inputLabel')}
              </label>
              <input
                id="advisor-input"
                value={draft}
                maxLength={500}
                autoComplete="off"
                placeholder={t('advisor.inputPlaceholder')}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-12 min-w-0 grow rounded-control border border-line-strong px-3 py-2"
              />
              <button
                type="submit"
                aria-label={t('advisor.send')}
                disabled={busy || draft.trim() === ''}
                className="flex size-12 shrink-0 items-center justify-center rounded-control border border-line-strong disabled:opacity-50"
              >
                <Send aria-hidden className="size-5" />
              </button>
            </form>
            <div className="flex flex-wrap justify-between gap-x-3">
              <Link href="/advisor/form" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
                {t('advisor.useForm')}
              </Link>
              <button type="button" disabled={busy} onClick={() => void talkToPerson()} className="min-h-10 text-sm underline underline-offset-4">
                {t('advisor.talkToPerson')}
              </button>
              <button type="button" disabled={busy} onClick={restart} className="min-h-10 text-sm underline underline-offset-4">
                {t('advisor.startOver')}
              </button>
            </div>
          </>
        )}
      </StickyBar>
    </div>
  );
}
