import { z } from 'zod';
import { CONSENT_PURPOSES, DELAY_REASONS, DOCUMENT_TYPES, GSTIN_STATUSES } from '../db/schema/enums';

// Request schemas for the API. Strict, so an unknown field is a 400 rather than silently ignored.

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

const phoneSchema = z
  .string()
  .transform((value) => value.replace(/^\+91/, '').replace(/[\s-]/g, ''))
  .pipe(z.string().regex(INDIAN_MOBILE));

export const otpRequestSchema = z.strictObject({ phone: phoneSchema });

export const otpVerificationSchema = z.strictObject({
  challengeId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/),
});

export const consentGrantSchema = z.strictObject({
  purpose: z.enum(CONSENT_PURPOSES),
  noticeVersion: z.string().min(1).max(50),
  language: z.string().regex(/^[a-z]{2}$/),
});

export const emptySchema = z.strictObject({});

export const simulationSchema = z.strictObject({ enabled: z.boolean() });

const MAX_COUNT = 100_000;
const MAX_QUANTITY = 1000;

const count = z.number().int().min(0).max(MAX_COUNT);

export const businessProfileSchema = z.strictObject({
  cityTier: z.number().int().min(1).max(5).nullable(),
  employeeCount: count.nullable(),
  numSites: count.nullable(),
  gstinStatus: z.enum(GSTIN_STATUSES),
  fibreAvailable: z.boolean().nullable(),
});

const NEEDS = [
  'UPTIME',
  'CUSTOMER_OUTREACH',
  'BULK_SMS',
  'SECURITY',
  'GUEST_WIFI',
  'CENTRAL_MANAGEMENT',
  'PHONE_LINES',
  'BUSINESS_CALLS',
  'TOLL_FREE',
  'EMAIL',
  'BACKUP',
  'WEBSITE',
  'POS',
  'CCTV',
  'REMOTE_ACCESS',
  'FLEET',
  'MACHINE_MONITORING',
] as const;

export const discoveryProfileSchema = z.strictObject({
  businessType: z.string().trim().min(1).max(80).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  // Given directly, or worked out from `city` and `businessType` by the server.
  cityTier: z.number().int().min(1).max(5).nullable().optional(),
  segment: z.enum(['micro', 'prof', 'multi', 'mfg']).nullable().optional(),
  employeeCount: count.nullable(),
  numSites: count.nullable(),
  gstinStatus: z.enum(GSTIN_STATUSES),
  fibreAvailable: z.boolean().nullable(),
  connectivity: z.enum(['NONE', 'STANDARD', 'HIGH_SPEED', 'DEDICATED', 'DEDICATED_HIGH']),
  needs: z.array(z.enum(NEEDS)).max(NEEDS.length),
  counts: z
    .strictObject({
      lines: count.optional(),
      users: count.optional(),
      devices: count.optional(),
      cameras: count.optional(),
      counters: count.optional(),
      vehicles: count.optional(),
      channels: count.optional(),
      machines: count.optional(),
    })
    .default({}),
});

const quantity = z.number().int().min(1).max(MAX_QUANTITY);

export const quoteCreateSchema = z.strictObject({
  profile: businessProfileSchema,
  lines: z
    .array(z.strictObject({ productId: z.string().regex(/^P\d{2}$/), quantity }))
    .max(30)
    .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, 'duplicate product'),
});

export const quoteLineSchema = z.strictObject({ quantity: quantity.optional() });

const personName = z.string().trim().min(2).max(120);

// The certificate is checked again by the domain, so this only stops obvious junk.
const gstinInput = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[0-9A-Z]{15}$/));

export const kycApplicationCreateSchema = z.strictObject({
  quoteId: z.string().min(1).max(100),
  contactName: personName.optional(),
  // Needed only when there is no GSTIN to read the business name from.
  businessName: z.string().trim().min(2).max(160).optional(),
  gstin: gstinInput.optional(),
});

export const kycContactSchema = z.strictObject({ contactName: personName });

export const gstinConfirmationSchema = z.strictObject({ gstin: gstinInput });

export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export const orderCreateSchema = z.strictObject({
  quoteId: z.string().min(1).max(100),
  kycApplicationId: z.string().min(1).max(100),
});

// No field can carry card details, and a strict schema refuses any that are sent.
export const paymentAttemptSchema = z.strictObject({ simulate: z.enum(['SUCCESS', 'FAILURE']) });

export const orderDelaySchema = z.strictObject({
  reason: z.enum(DELAY_REASONS),
  newDate: z.iso.date(),
});
