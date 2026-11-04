---
name: privacy-security
description: Apply Udyam Digital privacy and security requirements, including DPDP Act 2023 considerations, the consent lifecycle, purpose limitation, data minimisation, retention, secure document storage, authentication, API security and input validation. Use when designing or reviewing anything that handles personal data, documents, logs, sessions, LLM calls or file uploads, and when writing the 1-page privacy note.
---

# Privacy and Security

The README says to treat this synthetic data as if it were real. A 1-page privacy and security note is a required deliverable, so every claim in it must be true of the code.

This is engineering guidance, not legal advice. Check the current DPDP Act and Rules text before citing a specific obligation or period. The DPDP Rules 2025 add operational detail on a phased timeline.

## DPDP Act 2023 mapping

Accel Business is the **Data Fiduciary** and the owner or signatory is the **Data Principal**. Business documents still contain personal data: a proprietor's GST legal name is a person's name, and signatory IDs and bills identify individuals.

| Section | Requirement | In this product |
|---|---|---|
| s.5 Notice | Say what is collected, why, how to exercise rights and how to complain, with an option of English or an Eighth Schedule language | Notice screen in the owner's language, before any collection |
| s.6 Consent | Free, specific, informed, unconditional, unambiguous, by clear affirmative action; only what's necessary; as easy to withdraw as to give | Unticked controls, separate per purpose, withdrawal in settings |
| s.7 Legitimate uses | Some processing doesn't need consent, but rely on this narrowly | Consent is our default basis |
| s.8 Obligations | Accuracy, security safeguards, breach notice to the Board and affected people, erasure once the purpose ends, published contact | Encrypted storage, retention job, incident runbook, contact shown |
| s.9 Children | Extra rules for under-18s | Confirm the signatory is an adult |
| s.11 to 14 Rights | Access, correction, erasure, grievance redress, nomination | "My data" screen with view, correct, delete and grievance contact |
| s.16 Cross-border | Transfers may be restricted by government | State where each processor runs; flag LLM calls in the note |

Penalties can reach ₹250 crore for failing to take reasonable security safeguards (Schedule). Mention this in the business case as a risk, if at all.

## Consent lifecycle

```
NOT_ASKED -> NOTICE_SHOWN -> GRANTED -> WITHDRAWN -> ERASURE_PENDING -> ERASED
                         \-> DECLINED            \-> EXPIRED (purpose complete)
```

### Separate purposes

| Purpose ID | Covers | Required for |
|---|---|---|
| `advisor_profile` | Business details for a recommendation | Advisor |
| `kyc_verification` | Documents and registry lookups | Activation |
| `service_updates` | Order status messages | Optional |
| `marketing` | Promotions | Optional; **never bundled** |

### Consent record

Append-only, with no edits or deletes during its retention period:

```
consent_id, subject_ref, purpose_id, notice_version, language, status, granted_at, withdrawn_at, channel
```

### Rules

- Enforce consent on the server: a KYC API call without an active `kyc_verification` consent returns `403 CONSENT_REQUIRED`. A UI check alone isn't enough.
- Withdrawing `marketing` must not affect the order. Withdrawing `kyc_verification` stops processing and starts deletion, and the owner is told the effect on activation before confirming.
- Changing the notice's meaning requires fresh consent.

## Purpose limitation and minimisation

Justify each field by the step that needs it. If nothing needs it, don't collect it.

| Step | Collect | Don't collect |
|---|---|---|
| Advisor | Business type, city, size, needs, GSTIN status (yes or no) | Personal names, full identifiers, documents |
| Quote | Bundle selection, contact phone | Payment details before checkout |
| KYC | Required documents and identifiers | Date of birth or other extra ID fields; mask them if a document shows them |
| Tracker | Order ID and status | Anything else |
| Analytics | Aggregates and pseudonymous IDs | Names, phones, identifiers |

KYC data must never feed marketing or propensity scoring without its own consent. Keep them in separate tables, with no shared join for analytics.

### Masking

| Data | Display and logs |
|---|---|
| GSTIN | `32TTN•••••••1ZW` |
| Udyam | `UDYAM-KL-00-•••8801` |
| Signatory ID | Last 4 only |
| Phone | `••••••1234` |
| Name in logs | Never; use a pseudonymous `subject_ref` |

Full values appear only to the owner, on an explicit reveal. Implement this in one shared helper and log formatter.

## Retention

These are proposed defaults. Whatever the team chooses goes into the privacy note and is enforced by a scheduled job with a test.

| Data | Proposed retention |
|---|---|
| Raw document images | Deleted within 30 days of verification, or immediately on rejection or withdrawal |
| Extracted KYC fields | For the contract term, then as required by law |
| Advisor conversations | 90 days, with identifiers redacted |
| Consent and audit records | As long as needed to prove compliance |
| Abandoned leads | 180 days, then erased |
| Application logs | 30 days, masked |

## Secure document storage

- Store outside any public directory, never in `public/`.
- Encrypt each file with AES-256-GCM using a per-file data key, wrapped by a master key from the environment.
- Generate storage names as random IDs. Never use a user-supplied filename in a path.
- Serve through an authorised route with short-lived access, `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`.
- Strip EXIF data, because phone photos carry location.
- Keep documents out of the database and out of backups that outlive their retention period.

### Upload validation

- Allow JPEG, PNG and PDF, verified by magic bytes. Reject SVG and HTML.
- Limit size to 10 MB, and pixel dimensions, to stop decompression bombs.
- Re-encode images through `sharp` to remove embedded payloads.
- Limit PDFs to a small page count and rasterise them, with no scripts.
- Rate limit per session.

## Authentication and authorisation

- Owners sign in with phone OTP, mocked for the demo with a clearly labelled test code. Never hard-code a real-looking secret.
- Use signed, server-side sessions in cookies set `HttpOnly`, `Secure` and `SameSite=Lax`.
- Back office requires a separate role-based login: `partner` sees only assigned leads, `sales` sees leads, `admin` sees audit data.
- **Check ownership on every object.** A tracker or document request for another owner's order returns 404. Sequential IDs must not allow enumeration, so use random public IDs.
- Default to deny, and put checks in a shared server guard.
- Partner views show masked identifiers and never raw documents.

## API security

- Validate every request with Zod on the server, and reject unknown fields.
- Use parameterised queries through the ORM. No string-built SQL.
- Return generic errors with a `request_id`, and never stack traces.
- Rate limit OTP, uploads, registry lookups and advisor messages. The registry lookup must not become a way to enumerate businesses.
- Add CSRF protection on cookie-authenticated writes, and a strict CORS allowlist.
- Set headers: Content-Security-Policy, HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`.
- Never put identifiers in URLs or query strings where they can avoid it. Registry lookups from the client go by `POST` to our server; the mock registry's own `GET` is server-to-server only.
- Add idempotency keys on order creation.

## LLM safety

- Minimise what's sent: replace names and identifiers with placeholders, and send business attributes only.
- Don't send KYC documents or raw OCR text to the LLM by default.
- **Treat all user messages and OCR text as untrusted.** The prompt injection defence is structural: the LLM has no tools that bypass eligibility, prices or KYC verdicts.
- Validate outputs, never render LLM output as raw HTML, and don't log full prompts with personal data.
- Name the LLM provider as a processor in the notice and the note, with the region and the provider's data retention terms as confirmed at the time of writing.

## Secrets and supply chain

- Keep secrets in `.env.local`, ignored by git, with `.env.example` holding names only.
- Never log keys or expose them through `NEXT_PUBLIC_`.
- Keep dependencies few, commit lockfiles and run `npm audit` before submission.
- Never seek or use the judges-only pack.

## Audit and incidents

- Keep an append-only audit log of document views, reveals, role changes, consent changes and exports: who, what, when, with no personal values.
- Write a short incident runbook covering detection, containment and notifying the Board and affected people.

## 1-page privacy note outline

Keep it to one page and make every line verifiable.

1. What we collect, per step, and what we deliberately don't
2. Consent: notice, purposes, withdrawal
3. Where data goes: storage, processors, LLM, region
4. Security: encryption, access control, masking, validation
5. Retention table
6. Owner rights and grievance contact
7. Known prototype limits, such as mocked OTP and mock registries, and what production would need

## Review checklist

- [ ] New field is justified by a named step
- [ ] Server enforces consent and ownership
- [ ] Identifiers are masked in UI and logs
- [ ] Input validated; errors are generic
- [ ] Nothing sensitive in URLs, logs, analytics or LLM prompts
- [ ] Retention is defined and enforced
- [ ] Tests cover consent missing, wrong owner and malformed input
- [ ] The privacy note still matches the code
