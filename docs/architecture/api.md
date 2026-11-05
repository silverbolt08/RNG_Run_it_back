# API reference

The REST API under `/api/v1`, built in Phase 3 of the [blueprint](../blueprint.md). All data is synthetic. The operator in the product is Accel Business.

## Conventions

- JSON bodies use `camelCase`, dates are ISO 8601, and money is whole rupees in fields ending `Inr`.
- Success returns the resource directly. Every error has this shape:

```json
{ "error": { "code": "CONSENT_REQUIRED", "message": "Safe message", "details": {}, "requestId": "req_..." } }
```

- Show your own wording from the message catalogues, chosen by `code`. `message` is a safe English fallback.
- Every response has an `x-request-id` header and `cache-control: no-store`.
- Unknown request fields return `400 INVALID_REQUEST`. `details.issues` lists `{ path, code }`, and never repeats a value.
- Public IDs are random strings with a prefix, such as `qt_...`. Don't parse them.
- Lists are `{ "items": [...], "nextCursor": string | null }`. Pass `?limit=` (1 to 100, default 20) and `?cursor=`.

### Sessions and cookies

The session is an `HttpOnly`, `SameSite=Lax` cookie named `udyam_session`, so the browser sends it for you. Call `POST /sessions` on the first visit. Verifying a phone replaces the cookie, so don't cache it anywhere.

### Status codes

| Status | Meaning |
|---|---|
| 200, 201 | Success, created. A replayed idempotent request returns 200 |
| 400 | Invalid input: `INVALID_REQUEST` |
| 401 | `SESSION_REQUIRED`, or `SERVICE_TOKEN_REQUIRED` on the mock registry |
| 403 | `CONSENT_REQUIRED` (`details.purpose` names which), `PHONE_VERIFICATION_REQUIRED`, `ADMIN_REQUIRED`, `CROSS_SITE_REQUEST` |
| 404 | `NOT_FOUND`, including another owner's object |
| 409 | Conflict with current state. Codes are listed per route |
| 422 | A business rule rejected a valid request. Codes are listed per route |
| 429 | `RATE_LIMITED`, with a `retry-after` header in seconds, or `OTP_ATTEMPTS_EXCEEDED`. Limits are per session: quote changes 120 a minute, recommendations 60 a minute, and the others are listed with their routes |
| 500 | `INTERNAL_ERROR`. Progress already saved stays saved |
| 503 | `OCR_UNAVAILABLE`, or `REGISTRY_UNAVAILABLE` on the mock registry. Retry |

### The journey in order

```
POST /sessions                        first visit
POST /consents  advisor_profile       after the short notice
POST /recommendations                 guided path
POST /quotes, then PUT and DELETE lines
POST /sessions/otp-requests and /otp-verifications
POST /quotes/{id}/acceptance
POST /consents  kyc_verification      after the full notice
POST /kyc-applications
POST /kyc-applications/{id}/documents for each document
POST /orders
POST /orders/{id}/payment-attempts
GET  /orders/{id}                     the tracker
```

`GET /sessions/current` returns where the owner got to, so any screen can resume after a reload.

## Sessions

### `POST /sessions`

Public. No body. Returns `201` and sets the cookie, or `200` if a valid session already exists.

```json
{ "phoneVerified": false, "phoneMasked": null, "expiresAt": "2026-12-04T10:00:00.000Z" }
```

### `GET /sessions/current`

As above, plus where the owner got to. Each ID is `null` if there is none yet.

```json
{
  "phoneVerified": true,
  "phoneMasked": "••••••1234",
  "expiresAt": "...",
  "journey": { "quoteId": "qt_...", "kycApplicationId": "kyc_...", "orderId": "ord_..." }
}
```

### `DELETE /sessions/current`

Returns `{ "ended": true }` and clears the cookie.

### `POST /sessions/otp-requests`

Mock OTP. Request `{ "phone": "9876541234" }`. A `+91` prefix is allowed. Limited to 5 per 10 minutes.

`201`:

```json
{
  "challengeId": "otp_...",
  "expiresAt": "...",
  "phoneMasked": "••••••1234",
  "delivery": "MOCK_NO_SMS_SENT",
  "testCode": "000000"
}
```

**Show `testCode` on screen, labelled as a test code.** No SMS is sent.

### `POST /sessions/otp-verifications`

Request `{ "challengeId": "otp_...", "code": "000000" }`.

`200` returns the session shape and sets a new cookie. If this phone already has an owner, the visitor's anonymous work and consents move to that owner.

Errors: `422 OTP_INCORRECT`, `422 OTP_EXPIRED`, `429 OTP_ATTEMPTS_EXCEEDED` after 5 wrong codes, `404 NOT_FOUND`.

## Consents

Purposes: `advisor_profile`, `ai_chat`, `kyc_verification`, `service_updates`, `marketing`. Each is separate, and none is implied by another. `ai_chat` lets an outside AI service read typed chat, so the short form and tapped answers work without it.

### `GET /consents`

One item per purpose, and `nextCursor` is always `null`.

```json
{
  "items": [
    {
      "purpose": "kyc_verification",
      "status": "GRANTED",
      "currentNoticeVersion": "2026-11-v1",
      "noticeVersion": "2026-11-v1",
      "language": "en",
      "grantedAt": "...",
      "withdrawnAt": null
    }
  ],
  "nextCursor": null
}
```

`status` is one of:

| Status | Meaning | Ask again? |
|---|---|---|
| `NOT_ASKED` | No decision yet | Yes |
| `GRANTED` | Active | No |
| `NOTICE_CHANGED` | Granted to an older notice, which no longer counts | Yes |
| `WITHDRAWN` | Withdrawn. For `kyc_verification` on an activated order, fields stay for the contract term | Yes, if needed |
| `ERASED` | Withdrawn, and KYC data has been erased | Yes, if needed |

### `POST /consents`

Request `{ "purpose": "kyc_verification", "noticeVersion": "2026-11-v1", "language": "en" }`. Send the `currentNoticeVersion` from the list. `language` is a two-letter code.

`201` returns one item. Error: `409 NOTICE_OUTDATED`, with `details.currentNoticeVersion`.

### `POST /consents/{purpose}/withdrawal`

No body. `200` returns one item plus `effects`:

```json
{
  "purpose": "kyc_verification",
  "status": "WITHDRAWN",
  "effects": { "applicationsStopped": 1, "documentsDeleted": 4, "ordersCancelled": 1, "draftQuotesDeleted": 0 }
}
```

Error: `409 CONSENT_NOT_ACTIVE`.

**Tell the owner the effect before calling this.** It takes effect at once.

| Purpose | Effect of withdrawing |
|---|---|
| `kyc_verification` | Stops processing and deletes documents and extracted fields. Cancels any order not yet activated. On an activated order, only the raw documents go, and the fields stay until the contract ends |
| `advisor_profile` | Deletes draft and saved quotes and advisor conversations. Accepted quotes stay |
| `service_updates` | Stops status messages. Nothing else changes |
| `ai_chat` | Nothing more goes to the LLM. The advisor works on tapped answers |
| `marketing` | Nothing else changes |

## Products

### `GET /products`

Public, with cursor pagination. Items are sorted by ID.

```json
{
  "items": [
    {
      "id": "P01",
      "category": "Connectivity",
      "name": "Biz Fibre 100",
      "description": "Business fibre broadband, 100 Mbps, unlimited data",
      "unit": "per site",
      "unitPriceInr": 1099,
      "priceMinInr": 999,
      "priceMaxInr": 1199,
      "setupInr": 0,
      "minContractMonths": 12,
      "cityTiers": [1, 2],
      "minEmployees": 1,
      "minSites": 1,
      "requiresGstin": false,
      "requiresOneOf": [],
      "installDays": 5,
      "targetSegments": ["micro", "prof"]
    }
  ],
  "nextCursor": "P10"
}
```

Show `name` and `description`. Don't show product IDs to the owner. `unitPriceInr` is the one price to display.

## Advisor conversations

All need `advisor_profile` consent. The browser sends the language of its screens, and the reply follows the language of the owner's latest words.

### `POST /conversations`

Request `{ "language": "en" }`, or with `"restart": true` to start afresh. Returns `201` with a new chat, or `200` with the open one. The greeting spends no LLM call.

### `GET /conversations/current`

Returns the owner's latest chat that isn't closed, or `404`.

### `POST /conversations/{id}/messages`

Send text, a tapped answer, or both. A tapped answer's text is only what the chat shows. Limited to 20 a minute.

```json
{ "text": "Salon in Pune, 4 of us", "language": "en" }
{ "answer": { "slot": "GSTIN", "value": "NONE" }, "text": "No GST", "language": "en" }
```

| `slot` | `value` |
|---|---|
| `BUSINESS` | `SHOP`, `OFFICE`, `CHAIN`, `FACTORY` |
| `CITY_TIER` | `1`, `2`, `3` or `DECLINED` |
| `EMPLOYEES`, `SITES` | A whole number or `DECLINED` |
| `GSTIN` | `ACTIVE`, `CANCELLED`, `SUSPENDED`, `NONE`, `UNKNOWN` |
| `FIBRE` | `true`, `false` or `DECLINED` |
| `NEEDS` | A list of needs, which may be empty |

`200` returns the conversation:

```json
{
  "id": "cnv_...",
  "status": "OPEN",
  "messages": [{ "role": "advisor", "source": "LLM", "text": "..." }],
  "askedSlot": "EMPLOYEES",
  "facts": { "businessType": "salon", "city": "Pune" },
  "recommendation": null,
  "handoffReason": null,
  "assistSuggested": false,
  "llmAvailable": true
}
```

| Field | Notes |
|---|---|
| `status` | `OPEN`, `HANDED_OFF`, `CLOSED` |
| `messages[].source` | `OWNER`, `LLM`, or `TEMPLATE` if the LLM was down or its words were refused |
| `askedSlot` | What to offer tappable answers for, or `null` once a recommendation is ready |
| `recommendation` | The same shape as `POST /recommendations`. Show it from these values, not from the chat text |
| `handoffReason` | `REQUESTED`, `NOT_SERVICEABLE_CITY`, `SITES_DIFFER`, `STUCK`, `TOO_MANY_TURNS` |
| `assistSuggested` | A site check is likely to help, so offer a person without forcing one |
| `llmAvailable` | `false` means typed text can't be read just now, so point to the tappable answers and the short form |

The LLM never fails this route. When it is down, the reply comes from a template.

### `POST /conversations/{id}/handoff`

Request `{ "language": "en" }`. Passes the chat to a person.

## Recommendations
### `POST /recommendations`

Needs `advisor_profile` consent. Stores nothing.

```json
{
  "businessType": "kirana store",
  "city": "Nashik",
  "employeeCount": 3,
  "numSites": 1,
  "gstinStatus": "NONE",
  "fibreAvailable": true,
  "connectivity": "STANDARD",
  "needs": ["CUSTOMER_OUTREACH"],
  "counts": {}
}
```

| Field | Values |
|---|---|
| `businessType`, `city` | Optional text. The server works out `segment` and `cityTier` from them |
| `cityTier`, `segment` | Optional. Given directly, they win. `segment` is `micro`, `prof`, `multi` or `mfg` |
| `employeeCount`, `numSites` | Whole number, or `null` if unknown. Rules that need it then block |
| `gstinStatus` | `ACTIVE`, `CANCELLED`, `SUSPENDED`, `NONE`, `UNKNOWN` |
| `fibreAvailable` | `true`, `false`, or `null` if unknown |
| `connectivity` | `NONE`, `STANDARD`, `HIGH_SPEED`, `DEDICATED`, `DEDICATED_HIGH` |
| `needs` | Any of `UPTIME`, `CUSTOMER_OUTREACH`, `BULK_SMS`, `SECURITY`, `GUEST_WIFI`, `CENTRAL_MANAGEMENT`, `PHONE_LINES`, `BUSINESS_CALLS`, `TOLL_FREE`, `EMAIL`, `BACKUP`, `WEBSITE`, `POS`, `CCTV`, `REMOTE_ACCESS`, `FLEET`, `MACHINE_MONITORING` |
| `counts` | Optional whole numbers: `lines`, `users`, `devices`, `cameras`, `counters`, `vehicles`, `channels`, `machines` |

`200`:

```json
{
  "profile": { "cityTier": 2, "employeeCount": 3, "numSites": 1, "gstinStatus": "NONE", "fibreAvailable": true, "segment": "micro" },
  "lines": [
    {
      "productId": "P01",
      "quantity": 1,
      "reason": { "kind": "CONNECTIVITY" },
      "name": "Biz Fibre 100",
      "description": "...",
      "unit": "per site"
    }
  ],
  "blocked": [
    {
      "productId": "P15",
      "name": "WhatsApp Business API Starter",
      "need": "CUSTOMER_OUTREACH",
      "eligible": false,
      "blockers": [{ "rule": "GSTIN_REQUIRED", "required": "ACTIVE", "actual": "NONE", "fixable": false }],
      "alternatives": ["P18"]
    }
  ],
  "quote": {
    "lines": [{ "productId": "P01", "quantity": 1, "unitPriceInr": 1099, "monthlyInr": 1099, "setupInr": 0 }],
    "monthlyTotalInr": 1099,
    "monthlyGstInr": 198,
    "monthlyFinalInr": 1297,
    "setupTotalInr": 0,
    "setupGstInr": 0,
    "setupFinalInr": 0,
    "contractMonths": 12,
    "installDays": 5,
    "gstRatePercent": 18
  }
}
```

`reason` is `{ "kind": "CONNECTIVITY" }` or `{ "kind": "NEED", "need": "UPTIME" }`. Each blocker carries values rather than sentences, so word it per language:

| `rule` | Other fields |
|---|---|
| `CITY_TIER` | `required: number[]`, `actual: number \| null` |
| `MIN_EMPLOYEES`, `MIN_SITES` | `required: number`, `actual: number \| null` |
| `GSTIN_REQUIRED` | `required: "ACTIVE"`, `actual: GstinStatus` |
| `FIBRE_NOT_AVAILABLE` | None |
| `DEPENDENCY` | `required: string[]`, `actual: string[]`, `fixable: boolean`, `eligibleBases: string[]` |

To turn a recommendation into a quote, send the `profile` back without `segment`, along with each line's `productId` and `quantity`.

## Quotes

### The quote resource

```json
{
  "id": "qt_...",
  "status": "DRAFT",
  "revision": 1,
  "gstRatePercent": 18,
  "profile": { "cityTier": 1, "employeeCount": 12, "numSites": 1, "gstinStatus": "ACTIVE", "fibreAvailable": true },
  "lines": [
    {
      "productId": "P01",
      "name": "Biz Fibre 100",
      "description": "...",
      "unit": "per site",
      "quantity": 1,
      "unitPriceInr": 1099,
      "monthlyInr": 1099,
      "setupInr": 0
    }
  ],
  "monthlyTotalInr": 1099,
  "monthlyGstInr": 198,
  "monthlyFinalInr": 1297,
  "setupTotalInr": 0,
  "setupGstInr": 0,
  "setupFinalInr": 0,
  "contractMonths": 12,
  "installDays": 5,
  "savedAt": null,
  "acceptedAt": null,
  "createdAt": "...",
  "updatedAt": "...",
  "applied": false,
  "comparison": null,
  "stranded": [],
  "blocked": []
}
```

- `status` is `DRAFT`, `SAVED`, `ACCEPTED` or `NEEDS_ACCEPTANCE`. Only `ACCEPTED` is locked.
- `applied`, `comparison`, `stranded` and `blocked` describe the change that produced this response. A plain read has none.

```json
{
  "comparison": {
    "monthlyDeltaInr": 1799,
    "monthlyFinalDeltaInr": 2123,
    "setupDeltaInr": 5000,
    "setupFinalDeltaInr": 5900,
    "contractMonthsBefore": 12,
    "contractMonthsAfter": 24,
    "contractChanged": true,
    "installDaysBefore": 5,
    "installDaysAfter": 10,
    "installChanged": true
  },
  "stranded": [{ "productId": "P09", "name": "Backup 4G/5G Failover", "requiredOneOf": ["P01", "P02", "P03", "P05", "P06"] }],
  "blocked": [{ "productId": "P15", "name": "...", "eligible": false, "blockers": [], "alternatives": [] }]
}
```

### `POST /quotes`

Needs `advisor_profile` consent.

```json
{
  "profile": { "cityTier": 1, "employeeCount": 12, "numSites": 1, "gstinStatus": "ACTIVE", "fibreAvailable": true },
  "lines": [{ "productId": "P01", "quantity": 1 }]
}
```

`201` returns the quote. A line the rules block isn't sold or silently dropped: it appears in `blocked`. `lines` may be empty. Error: `422 UNKNOWN_PRODUCT`.

### `GET /quotes` and `GET /quotes/{id}`

The list has cursor pagination, and its order is arbitrary. Use `journey.quoteId` for the latest.

### `PUT /quotes/{id}/lines/{productId}`

Needs `advisor_profile` consent. Request `{ "quantity": 2 }`. Omit `quantity` to use the domain's default.

`200` returns the quote with `comparison`.

**A blocked add-on also returns `200`,** with `applied: false`, the quote unchanged, and the reason in `blocked`. Check `applied`, rather than expecting an error.

Errors: `409 QUOTE_LOCKED`, `404 NOT_FOUND` for an unknown product.

### `DELETE /quotes/{id}/lines/{productId}`

Needs `advisor_profile` consent. `200` returns the quote with `comparison`, and in `stranded` anything removed because it lost its base. Warn the owner about those.

### `POST /quotes/{id}/acceptance`

No body. Needs a verified phone, so ask for one only at this point.

`200` returns the quote plus:

```json
{ "kycApplication": { "id": "kyc_...", "verdict": "MANUAL_REVIEW" } }
```

`kycApplication` is `null` if none has started. Accepting a quote that KYC changed also re-runs KYC against the new bundle, and this is its new verdict. Accepting twice changes nothing.

Errors: `403 PHONE_VERIFICATION_REQUIRED`, `422 EMPTY_QUOTE`, `422 QUOTE_NOT_ELIGIBLE` with `details.blocked`.

### `GET /quotes/{id}/add-ons`

Needs `advisor_profile` consent. Everything not in the bundle, each with `eligible`, `blockers` and `alternatives` for this bundle right now, plus `names` for wording a dependency without a product code. Show a blocked one disabled, with its reason.

### `POST /quotes/{id}/save`

No body, and no phone needed. Returns the quote as `SAVED`. It stays editable. Error: `409 QUOTE_LOCKED`.

## KYC applications

All writes need `kyc_verification` consent, or they return `403 CONSENT_REQUIRED` before anything is read or stored.

### The application resource

```json
{
  "id": "kyc_...",
  "quoteId": "qt_...",
  "status": "OPEN",
  "verdict": "NEEDS_CONFIRMATION",
  "contact": { "name": "Fatima Menon", "source": "OWNER" },
  "requiredDocuments": ["GST_CERTIFICATE", "SIGNATORY_ID", "ADDRESS_PROOF"],
  "missingDocuments": [],
  "documents": [
    {
      "id": "doc_...",
      "documentType": "GST_CERTIFICATE",
      "quality": "OK",
      "detectedType": "GST_CERTIFICATE",
      "ocrConfidence": 91,
      "uploadedAt": "..."
    }
  ],
  "gstin": {
    "masked": "27QHI•••••••1ZL",
    "confirmedByOwner": false,
    "confirmation": { "read": "27QHIXK0658U1ZL", "suggestion": "27QHJXK0658U1ZL" }
  },
  "checks": [{ "id": "GST_FORMAT", "severity": "HARD", "outcome": "FAIL", "onFail": "NEEDS_CONFIRMATION", "evidence": {} }],
  "quoteChange": null,
  "nextActions": ["CONFIRM_GSTIN"],
  "retryAfterSeconds": null,
  "assessedAt": "...",
  "verifiedAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

| Field | Values and notes |
|---|---|
| `status` | `OPEN`, `WITHDRAWN`, `ERASED` |
| `verdict` | `VERIFIED`, `RETAKE`, `NEEDS_CONFIRMATION`, `VERIFICATION_PENDING`, `MANUAL_REVIEW`, `REJECTED`, or `null` |
| `contact` | `name` is set only when `source` is `OWNER`. With `LEAD_PREFILL`, a name on file is used for the signatory check after a matching certificate, and is never returned |
| `documents[].quality` | `OK`, `BLURRED`, `UNREADABLE`, `WRONG_TYPE`, `PENDING_READ`. A wrong document names what was found in `detectedType`. `PENDING_READ` was kept during an OCR outage, and needs no retake |
| `gstin.masked` | Always safe to show |
| `gstin.confirmation` | Set only while the owner must check the number. `read` and `suggestion` are the one place full identifiers appear, and either can be `null` |

**`verdict` stays `null` until every required document is in and there's a contact name,** unless it is already `REJECTED`. Use `nextActions` to decide what to show:

| `nextActions` value | What to do |
|---|---|
| `PROVIDE_CONTACT_NAME` | `PUT .../contact` |
| `UPLOAD_DOCUMENTS` | Upload what's in `missingDocuments` |
| `RETAKE_DOCUMENT` | Retake any document with `quality` other than `OK`, or a failed check with `onFail: "RETAKE"`, such as a bill that is too old |
| `CONFIRM_GSTIN` | Show `gstin.confirmation`, then `POST .../gstin-confirmation` |
| `ACCEPT_NEW_QUOTE` | Show `quoteChange`, then `POST /quotes/{id}/acceptance` |
| `RETRY_VERIFICATION` | Say you'll finish shortly. Wait `retryAfterSeconds`, then `POST .../reassessment` |
| `PLACE_ORDER` | `POST /orders`. This includes `MANUAL_REVIEW`, which holds the order at its first stage |

Each check has `id`, `severity` (`HARD`, `SOFT`, `ADVISORY`), `outcome` (`PASS`, `FAIL`, `SKIPPED`, `PENDING`) and `onFail` (`REJECTED`, `RETAKE`, `NEEDS_CONFIRMATION`, `MANUAL_REVIEW`, `NONE`).

Check IDs: `GST_DOCUMENT`, `GST_FORMAT`, `GST_FOUND`, `GST_STATUS`, `GST_NAME`, `GST_ADDRESS`, `GST_STATE`, `UDYAM_PRESENT`, `UDYAM_NAME`, `UDYAM_DATE`, `UDYAM_ACTIVITY`, `ADDRESS_DOCUMENT`, `ADDRESS_MATCH`, `ADDRESS_AGE`, `BILL_NAME`, `SIGNATORY_DOCUMENT`, `SIGNATORY_NAME`, `SIGNATORY_VALID`, `SIGNATORY_BUSINESS`.

`evidence` holds values for building a specific message, such as `{ "ageDays": "257", "maxAgeDays": "90" }`, `{ "status": "Cancelled" }`, `{ "onDocument": "Nisha Arora" }` or `{ "problem": "BLURRED" }`. Values come from the owner's own documents, never from a registry. Never accuse anyone of fraud in the wording.

`quoteChange` is set when KYC finds the GSTIN isn't what the owner said and products had to go:

```json
{
  "reason": "GSTIN_STATUS",
  "gstinStatus": "CANCELLED",
  "dropped": [{ "productId": "P15", "name": "WhatsApp Business API Starter", "eligible": false, "blockers": [], "alternatives": ["P18"] }],
  "before": { "monthlyTotalInr": 2898, "setupTotalInr": 0, "contractMonths": 12, "installDays": 5 },
  "after": { "monthlyTotalInr": 1649, "setupTotalInr": 0, "contractMonths": 12, "installDays": 5 },
  "comparison": {},
  "requiresAcceptance": true
}
```

The verdict stays `REJECTED` until the owner accepts, because it describes the bundle they agreed to. Accepting re-runs KYC on the new bundle.

### `POST /kyc-applications`

Needs an accepted quote.

```json
{ "quoteId": "qt_...", "contactName": "Joseph Singh", "businessName": "Ganesh Woodcraft", "gstin": "27XUIXG0767D1ZP" }
```

`quoteId` and `declaredAdultSignatory: true` are required, the second only once the owner has ticked it. **Ask for `contactName` when the application starts,** because the signatory check compares against it. Send `businessName` only when there's no GSTIN. The declaration is kept in the audit log. Typing a `gstin` reveals nothing, because the application is assessed only once a document is in.

`201`, or `200` with the existing application if one is already open for this quote. Requests with a `gstin` share a limit of 15 per 10 minutes with GSTIN confirmations. Error: `409 QUOTE_NOT_ACCEPTED`.

### `GET /kyc-applications/{id}`

Needs no consent, so an owner who withdrew can still see that their data was erased.

### `PUT /kyc-applications/{id}/contact`

Request `{ "contactName": "..." }`. `200` returns the re-assessed application. Error: `409 APPLICATION_CLOSED`.

### `POST /kyc-applications/{id}/documents`

Send `multipart/form-data` with fields `documentType` and `file`, and no others. The `Idempotency-Key` header is required: 8 to 128 characters from letters, digits, `_` and `-`. Generate one per user action and reuse it on a retry.

`documentType` is `GST_CERTIFICATE`, `UDYAM_CERTIFICATE`, `SIGNATORY_ID` or `ADDRESS_PROOF`.

`201`:

```json
{ "document": { "id": "doc_...", "quality": "OK" }, "application": {}, "replayed": false }
```

A repeat with the same key returns `200` with `replayed: true`, creates nothing and doesn't run OCR again. `document` can then be `null` if a later upload has replaced it. A blurred or wrong document returns `201` too: check `document.quality`. A new document of the same type replaces the old one.

| Error | Meaning |
|---|---|
| `422 UNSUPPORTED_FILE_TYPE` | Not a JPEG or PNG, judged by its content |
| `422 PDF_NOT_SUPPORTED` | PDFs can't be read yet. Ask for a photo |
| `422 FILE_TOO_LARGE` | Over 10 MB |
| `422 IMAGE_TOO_LARGE` | Over 40 megapixels |
| `422 IMAGE_TOO_SMALL` | Shorter side under 300 pixels |
| `422 UNREADABLE_IMAGE` | Corrupt or not really an image |
| `409 IDEMPOTENCY_KEY_REUSED` | Same key, different file |
| `409 REQUEST_IN_PROGRESS` | The first request with this key is still running |
| `409 APPLICATION_CLOSED` | Withdrawn or erased |
| `429 RATE_LIMITED` | 30 uploads per 10 minutes |

Each upload took 0.3 to 1.1 seconds on this laptop, so show progress per document.

### `POST /kyc-applications/{id}/gstin-confirmation`

Request `{ "gstin": "27QHJXK0658U1ZL" }`: the number the owner read from their certificate. It's judged exactly as given. `200` returns the re-assessed application, masked again. By `POST`, so the identifier stays out of the URL.

Errors: `409 CONFIRMATION_NOT_REQUESTED` unless `CONFIRM_GSTIN` is in `nextActions`, and `422 GSTIN_TOO_DIFFERENT` if the number is more than a few characters from what was read, so this route can't look up another business or overturn a rejection.

### `POST /kyc-applications/{id}/reassessment`

No body. Reads any document kept during an OCR outage, then re-runs verification. Use it after an outage.

**During a registry or OCR outage nothing fails:** uploads and this route return `200` or `201` with `verdict: "VERIFICATION_PENDING"` once everything is in, and every document is kept.

## Orders

### The order resource, which is also the tracker

```json
{
  "id": "ord_...",
  "quoteId": "qt_...",
  "kycApplicationId": "kyc_...",
  "status": "ACTIVE",
  "stage": "KYC_CONFIRMED",
  "placedOn": "2026-07-15",
  "stages": [
    { "stage": "ORDER_PLACED", "status": "DONE", "expectedDate": "2026-07-15" },
    { "stage": "KYC_CONFIRMED", "status": "CURRENT", "expectedDate": "2026-07-15" },
    { "stage": "PAYMENT_CONFIRMED", "status": "UPCOMING", "expectedDate": "2026-07-15" },
    { "stage": "INSTALL_SCHEDULED", "status": "UPCOMING", "expectedDate": "2026-07-16" },
    { "stage": "INSTALLING", "status": "UPCOMING", "expectedDate": "2026-07-19" },
    { "stage": "ACTIVATED", "status": "UPCOMING", "expectedDate": "2026-07-20" }
  ],
  "next": { "stage": "PAYMENT_CONFIRMED", "action": "OWNER_PAYS", "actor": "OWNER", "expectedDate": "2026-07-15" },
  "products": [
    { "productId": "P01", "name": "Biz Fibre 100", "description": "...", "unit": "per site", "installDays": 5, "expectedDate": "2026-07-20" }
  ],
  "expectedActivationDate": "2026-07-20",
  "originalActivationDate": "2026-07-20",
  "delay": null,
  "alternativeProductIds": [],
  "kycUnderReview": false,
  "gstRatePercent": 18,
  "monthlyTotalInr": 2898,
  "monthlyFinalInr": 3420,
  "setupTotalInr": 0,
  "setupFinalInr": 0,
  "contractMonths": 12,
  "payment": {
    "status": "PENDING",
    "amountDueInr": 3420,
    "mock": true,
    "attempts": [{ "outcome": "FAILED", "amountInr": 3420, "attemptedAt": "..." }]
  },
  "statusMessages": [{ "templateCode": "ORDER_PLACED", "params": {}, "loggedAt": "..." }],
  "events": [
    { "type": "ORDER_PLACED", "stage": "KYC_CONFIRMED", "reasonCode": null, "newDate": null, "occurredOn": "2026-07-15", "simulated": false, "recordedAt": "..." }
  ],
  "activatedAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Put `next` above the fold.** It answers "what happens next and when".

| Field | Values and notes |
|---|---|
| `status` | `ACTIVE`, `CANCELLED`. A cancelled order has `next: null` |
| `next` | `null` once activated or cancelled |
| `next.action` | `ACCEL_REVIEWS_KYC`, `OWNER_PAYS`, `OWNER_RETRIES_PAYMENT`, `ACCEL_SCHEDULES_INSTALL`, `ACCEL_INSTALLS`, `ACCEL_ACTIVATES` |
| `next.actor` | `OWNER` or `ACCEL`. Show a pay button only for `OWNER` |
| `delay` | `{ "reason", "newDate", "previousDate" }`, or `null` |
| `delay.reason` | `FIBRE_NOT_FEASIBLE`, `PARTNER_DELAY`, `SITE_ACCESS`, `WEATHER`, `OTHER` |
| `alternativeProductIds` | `["P04"]` for AirFiber when the delay is `FIBRE_NOT_FEASIBLE`, otherwise empty |
| `kycUnderReview` | `true` while the order waits on a manual review. Paying is refused until it clears |
| `payment.status` | `PENDING`, `FAILED`, `PAID` |
| `statusMessages` | A mock log, filled only under `service_updates` consent. `templateCode` is `ORDER_PLACED`, `PAYMENT_FAILED`, `PAYMENT_CONFIRMED`, `ORDER_STAGE_CHANGED` (`params.stage`) or `ORDER_DELAYED` (`params.reason`, `params.newDate`) |
| `events[].simulated` | `true` if an admin control caused it. Label it so on any screen showing it |

Dates come from the fixed business date of 2026-07-15, so they show July 2026. Explain that in the demo.

### `POST /orders`

Needs `kyc_verification` consent, a verified phone and an `Idempotency-Key` header.

```json
{ "quoteId": "qt_...", "kycApplicationId": "kyc_..." }
```

`201` returns the order. A repeat with the same key returns `200` and the same order. `VERIFIED` starts at `KYC_CONFIRMED`, and `MANUAL_REVIEW` starts at `ORDER_PLACED` with `kycUnderReview: true`.

| Error | Meaning |
|---|---|
| `409 QUOTE_NOT_ACCEPTED` | Includes a quote waiting for re-acceptance after KYC changed it |
| `409 KYC_NOT_READY` | `details.verdict` says where it stands, and may be `null` |
| `422 KYC_REJECTED` | Verification didn't pass for this bundle |
| `422 KYC_QUOTE_MISMATCH` | The application is for another quote |
| `409 ORDER_EXISTS` | `details.orderId` names it |
| `409 IDEMPOTENCY_KEY_REUSED` | Same key, different quote or application |

### `GET /orders` and `GET /orders/{id}`

The list has cursor pagination. Use `journey.orderId` for the latest.

### `POST /orders/{id}/payment-attempts`

**A labelled mock.** No card data is collected, and any card field returns `400`. Show the owner a control for each outcome.

Request `{ "simulate": "SUCCESS" }` or `{ "simulate": "FAILURE" }`.

`201` returns the order. Success moves it to `PAYMENT_CONFIRMED`. Failure leaves the stage, and `next.action` becomes `OWNER_RETRIES_PAYMENT`. The amount is the setup fee plus the first month, which is an assumption.

Errors: `409 ALREADY_PAID`, `409 KYC_NOT_CONFIRMED`, `409 ORDER_NOT_ACTIVE`.

## Admin simulation controls

Each needs the `x-admin-token` header. Without it they return `403 ADMIN_REQUIRED`. Label these as simulations on any demo screen. Keep the token off the browser unless the screen is a local demo tool.

### `POST /admin/orders/{id}/stage-advances`

No body. `200` returns the order plus `"simulated": true`. Clearing a manual review is one advance. Errors: `409 PAYMENT_REQUIRED`, `409 ALREADY_ACTIVATED`, `409 ORDER_NOT_ACTIVE`.

### `POST /admin/orders/{id}/delays`

Request `{ "reason": "FIBRE_NOT_FEASIBLE", "newDate": "2026-08-10" }`. `200` returns the order plus `"simulated": true`. Only the products holding up activation move. Errors: `422 DELAY_NOT_LATER`, `409 ALREADY_ACTIVATED`, `409 ORDER_NOT_ACTIVE`.

### `PUT /admin/simulations/registry-outage`

Request `{ "enabled": true }`. `200` returns `{ "flag": "REGISTRY_OUTAGE", "enabled": true, "simulated": true }`.

### `POST /admin/retention-runs`

No body. Runs the retention job now, which otherwise runs daily.

```json
{
  "rawDocumentsDeleted": 0,
  "conversationsDeleted": 0,
  "applicationsErased": 0,
  "abandonedQuotesDeleted": 0,
  "abandonedOwnersDeleted": 0,
  "sessionsDeleted": 0,
  "otpChallengesDeleted": 0,
  "idempotencyKeysDeleted": 0,
  "ranAt": "..."
}
```

### `GET /admin/handoffs`

Chats the advisor handed to a person: business facts and a reason, with no chat text.

### `GET /admin/leads`

The top 25 past leads worth a call, by propensity score, with no name or identifier.

## Mock registry

Server-to-server only, and **not for the frontend.** Needs the `x-service-token` header, or returns `401 SERVICE_TOKEN_REQUIRED`. The app itself reaches the registries through `RegistryClient`, using the same records.

### `GET /mock-registry/gstin/{gstin}`

`200`:

```json
{ "gstin": "...", "legalName": "...", "tradeName": "...", "address": "...", "status": "Active" }
```

### `GET /mock-registry/udyam/{number}`

`200`:

```json
{ "udyamNumber": "...", "enterpriseName": "...", "majorActivity": "...", "city": "...", "state": "...", "dateOfRegistration": "..." }
```

Both return `400 INVALID_FORMAT`, `404 NOT_FOUND` and `503 REGISTRY_UNAVAILABLE`.
