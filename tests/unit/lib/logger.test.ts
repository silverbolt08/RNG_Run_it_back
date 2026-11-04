import { describe, expect, it } from 'vitest';
import { createLogger, type LogEntry } from '@/lib/logger';

const GSTIN = '32TTNXB7384T1ZW';
const PHONE = '9876541234';
const NAME = 'Prakash Shah';

function capture() {
  const entries: LogEntry[] = [];
  return { logger: createLogger((entry) => entries.push(entry)), entries, text: () => JSON.stringify(entries) };
}

describe('logger', () => {
  it('writes a structured entry with the allowed fields', () => {
    const { logger, entries } = capture();
    logger.info('api.request', { requestId: 'req_1', route: 'POST /api/v1/quotes', status: 201, durationMs: 4 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      event: 'api.request',
      requestId: 'req_1',
      route: 'POST /api/v1/quotes',
      status: 201,
      durationMs: 4,
    });
  });

  it('drops fields not on the allowlist, so a name can never be logged by accident', () => {
    const { logger, entries, text } = capture();
    logger.info('kyc.step', { contactName: NAME, name: NAME, business: NAME, status: 200 } as never);
    expect(text()).not.toContain(NAME);
    expect(entries[0]).toMatchObject({ status: 200, droppedFields: 3 });
  });

  it('masks an identifier that reaches an allowed field', () => {
    const { logger, text } = capture();
    logger.warn('kyc.step', { route: `GET /registry/${GSTIN}`, code: `phone ${PHONE}` });
    expect(text()).not.toContain(GSTIN);
    expect(text()).not.toContain(PHONE);
  });

  it('masks an identifier in the event name', () => {
    const { logger, text } = capture();
    logger.info(`lookup ${GSTIN}`);
    expect(text()).not.toContain(GSTIN);
  });

  it('logs only the type of an error, because its message may hold personal data', () => {
    const { logger, entries, text } = capture();
    logger.error('api.failure', { error: new TypeError(`bad GSTIN ${GSTIN} for ${NAME}`) });
    expect(text()).not.toContain(GSTIN);
    expect(text()).not.toContain(NAME);
    expect(entries[0]).toMatchObject({ level: 'error', errorName: 'TypeError' });
  });

  it('never logs an object value, which could hide a name inside', () => {
    const { logger, text } = capture();
    logger.info('kyc.step', { code: { contactName: NAME } as never });
    expect(text()).not.toContain(NAME);
  });
});
