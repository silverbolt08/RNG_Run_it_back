import { scrubIdentifiers } from './mask';

export type LogLevel = 'info' | 'warn' | 'error';

// An allowlist, not a blocklist: a name can't be recognised by pattern, so the only safe rule
// is that a field stays out unless someone decided here that it is safe to log.
const ALLOWED_FIELDS = [
  'requestId',
  'route',
  'method',
  'status',
  'durationMs',
  'subjectRef',
  'code',
  'count',
  'job',
  'purpose',
  'verdict',
  'documentType',
  'quality',
  'orderId',
  'quoteId',
  'applicationId',
  'conversationId',
  // Codes set by the advisor's own code, never words from the owner or the LLM.
  'reason',
  'source',
  'nextKind',
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

export type LogFields = Partial<Record<AllowedField, string | number | boolean | null>> & { error?: unknown };

export type LogEntry = {
  level: LogLevel;
  event: string;
  time: string;
  errorName?: string;
  droppedFields?: number;
} & Partial<Record<AllowedField, string | number | boolean | null>>;

export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_FIELDS);

/** Application logs go to stdout. The host keeps them for the 30 days set in the retention policy. */
export function createLogger(sink: (entry: LogEntry) => void = writeToStdout): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    sink(toEntry(level, event, fields));
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

function toEntry(level: LogLevel, event: string, fields: LogFields): LogEntry {
  const entry: LogEntry = { level, event: scrubIdentifiers(event), time: new Date().toISOString() };
  let dropped = 0;

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'error') {
      // The type only. An error's message can quote a name or an identifier.
      entry.errorName = value instanceof Error ? value.name : 'UnknownError';
    } else if (ALLOWED.has(key) && isPlainValue(value)) {
      (entry as Record<string, unknown>)[key] = typeof value === 'string' ? scrubIdentifiers(value) : value;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) entry.droppedFields = dropped;
  return entry;
}

function isPlainValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function writeToStdout(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}
