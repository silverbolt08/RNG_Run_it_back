---
name: smart-kyc
description: Build or change the Udyam Digital KYC flow, including document upload, OCR and field extraction, GSTIN and Udyam validation, mock registry lookups, cross-document consistency checks, verdicts, error handling, consent capture and data minimisation. Use for anything touching kyc_documents, mock_gstin_registry.csv, mock_udyam_registry.csv or the KYC screens and APIs.
---

# Smart KYC

Make KYC near-instant while staying compliant. Judges hold a private answer key for specimens K01 to K12, so each planted problem must produce the right, specific message. Use with `privacy-security`.

## Pipeline

```
consent -> document requirements -> upload -> quality gate -> OCR -> parse fields
  -> format and checksum -> registry lookup -> cross-document checks -> verdict
```

Each step records a structured result with a check ID, outcome, evidence fields and an owner-facing message. A failure on one document never loses the others.

## Consent comes first

Nothing is uploaded or looked up before the owner agrees. The screen must show, in their language: what is collected, why, who sees it, how long it is kept and how to withdraw. Record a versioned consent row. Details are in `privacy-security`.

## What to ask for

Collect only what this order needs. Skip anything a lookup already proves.

| Document | When required |
|---|---|
| GST certificate | The bundle contains a `requires_gstin` product, or the owner gives a GSTIN |
| Udyam certificate | Optional if the number is found in the registry; never block a sale on it alone |
| Signatory ID | Always |
| Address proof | Always; must be no older than 90 days |

This table is a team assumption. The brief lists all four documents, but 1,466 of 5,000 leads have no GSTIN and 2,277 have no Udyam number, and many products don't need either. Ask for the number first: a successful lookup can shorten the journey to a confirmation.

## Upload handling

| Situation | Behaviour |
|---|---|
| Wrong file type | Accept JPEG, PNG and PDF only, and check magic bytes as well as the extension |
| Over 10 MB or unreadable | Clear message and retry without losing progress |
| Blurred image | Ask for a retake with a tip. Don't guess values |
| Skewed or rotated image | Deskew automatically and continue |
| Wrong document type in a slot | Name what was detected and what is expected |
| Network drop | Resume; never duplicate the upload |
| Camera capture on a phone | Offer it as the default |

## Quality gate

Run before OCR, using `sharp`:

- **Blur:** variance of the Laplacian, below a threshold means retake. K04's GST certificate scores 1 and every other specimen scores 433 or more. Recalibrate on phone photos.
- **Skew:** handled during OCR by `rotateAuto` in `tesseract.js`, which measured -6.9° on K02's GST certificate and rotated nothing else.
- **Size:** reject images too small to read.

## OCR and parsing

Use local OCR by default (`tesseract.js`) behind an `OcrProvider` interface, so documents don't leave our system. An LLM vision provider may sit behind the same interface, but only if the consent notice says so and it is off by default.

**Measured on 2026-11-04:** `tesseract.js` read 96.8% of fields correctly across the specimens, excluding K04's blurred certificate, and 99.2% after GSTIN repair. Phone photos are untested. See `docs/spikes/ocr-accuracy.md`.

Specimen quirks:

- Pink diagonal "SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT" watermarks cross the text. **Don't filter them out.** A hue filter removed parts of characters and cut field accuracy to 77%, and a gentler one gained nothing.
- Fields are `label: value` rows. Parse by label, not by position.
- **Addresses wrap mid-word.** "Visakhapatnam, A" continues as "ndhra Pradesh - 118383", and K05's PIN splits as "75" then "2083". Join continuation rows with no space.
- GST certificate legal names for proprietors read `Neha Kaur (Prop. Vindhya Tours & Travels)`. Parse out both the person and the business.
- Signatory IDs have a different layout from the certificates.
- PIN codes are synthetic. Compare them across documents but don't validate them against a real state.

Fields by document:

| Document | Fields |
|---|---|
| GST certificate | GSTIN, legal name, trade name, constitution, address, date of liability, registration type |
| Udyam certificate | Udyam number, enterprise name, major activity, city, state, registration date |
| Signatory ID | Name, designation, business, ID number, valid till |
| Address proof | Consumer number, billed to, supply address, bill date |

Store a confidence per field. Below the threshold, ask the owner to confirm the value rather than failing.

## Identifier validation

### GSTIN

All 3,534 registry GSTINs pass this regex and checksum.

```ts
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gstinChecksumOk(g: string): boolean {
  if (!GSTIN_RE.test(g)) return false;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(g[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(p / 36) + (p % 36);
  }
  return CH[(36 - (total % 36)) % 36] === g[14];
}
```

- **Accept `X`** as the 4th PAN character. The README says it's always `X` in this data, which real validators reject.
- The first two digits must match the state. The pack has 14 state codes: 03 Punjab, 07 Delhi, 08 Rajasthan, 09 Uttar Pradesh, 10 Bihar, 19 West Bengal, 23 Madhya Pradesh, 24 Gujarat, 27 Maharashtra, 29 Karnataka, 32 Kerala, 33 Tamil Nadu, 36 Telangana, 37 Andhra Pradesh.

### OCR repair by position

GSTIN positions have fixed character classes, so confusable characters can be repaired only where the class is violated: letter positions turn 0 into O, 1 into I, 5 into S and 8 into B, and digit positions do the reverse. Position 14 is always `Z`, so a 7 or 2 there becomes `Z`. The last character can be a letter or a digit, so only the checksum settles O or 0. Accept a repair only if the checksum then passes, and show the result for the owner to confirm.

- K02: read as `19E0GXH4115Y1ZL`, position 4 must be a letter, repair to `O`, checksum passes.
- K06: `08YKZXS8189L1ZO` has a valid digit in a digit position, so there's nothing to repair. It fails the checksum and must end in rejection. **Never "fix" it to the registry's value.**
- K10: OCR reads `I` for `J` at position 5. Both are letters, so position repair can't help, and the checksum fails just as it does for K06. Reading the row at a higher resolution gave the same result, and OCR confidence doesn't separate the two cases.

**A checksum failure on an OCR value is never an immediate rejection.** Return `NEEDS_CONFIRMATION`: show what was read, with at most one look-alike suggestion that passes the checksum, and ask the owner to check it against their certificate. Build suggestions without using the registry, then run the normal lookup on what the owner confirms. K10 continues to its signatory check, and K06 is still rejected, by the checksum or by the lookup.

### Udyam

`/^UDYAM-[A-Z]{2}-00-\d{7}$/` matches all 2,723 registry entries. District `00` doesn't exist in reality, so accept it here. The two letters must match the state.

## Mock registries

Back the APIs with the CSVs, imported into the database. Application code must treat them as remote services, behind a `RegistryClient` with timeouts and retries, so it can be swapped for a real provider.

```
GET /api/v1/mock-registry/gstin/{gstin}   200 record | 404 NOT_FOUND | 400 INVALID_FORMAT | 503
GET /api/v1/mock-registry/udyam/{number}  200 record | 404 NOT_FOUND | 400 INVALID_FORMAT | 503
```

GST statuses: Active 3,266, Cancelled 167, Suspended 101. Only Active passes.

- Add a way to simulate an outage for the demo. On 503, save progress and tell the owner verification will finish shortly; don't fail the application.
- Rate limit, and return only the fields the flow needs.
- Prior leads and registry rows match one-to-one, so a lookup miss means a bad number.

## Cross-document checks

Normalise before comparing: casefold, drop punctuation and suffixes such as "Pvt Ltd", "LLP" and "Prop.", and collapse spaces.

| ID | Check | Severity |
|---|---|---|
| `GST_FORMAT` | Regex and checksum | Hard |
| `GST_STATUS` | Registry status is Active | Hard, when the bundle needs a GSTIN |
| `GST_NAME` | Certificate legal and trade names match the registry | Hard |
| `GST_ADDRESS` | Certificate address matches the registry | Soft |
| `UDYAM_PRESENT` | Number is present, readable and in the registry | Soft |
| `UDYAM_NAME` | Enterprise name matches the GST trade name | Soft |
| `UDYAM_DATE`, `UDYAM_ACTIVITY` | Certificate matches the registry | **Advisory: recorded, never changes the verdict** |
| `ADDRESS_MATCH` | Bill supply address matches the GST address | Hard |
| `ADDRESS_AGE` | Bill date within 90 days of today | Hard |
| `BILL_NAME` | Billed-to matches the business | Hard |
| `SIGNATORY_NAME` | ID name matches the application contact and, for proprietors, the GST person | Hard |
| `SIGNATORY_VALID` | ID "valid till" is after today | Hard |
| `SIGNATORY_BUSINESS` | Business on the ID matches | Hard |

The code also has `GST_DOCUMENT`, `ADDRESS_DOCUMENT` and `SIGNATORY_DOCUMENT` for missing, blurred or wrong documents, `GST_FOUND` for the registry lookup, and `GST_STATE` (soft) for the state code against the address. With a bundle that needs no GSTIN, GST faults are advisory, because a bad GSTIN then simply counts as none. The checks live in `src/domain/kyc`, and `assess-kyc.ts` holds the verdict order.

**Why the Udyam date and activity checks are advisory:** all 10 numbered Udyam certificates show a different registration date from the registry, and K06, K10, K11 and K12 also differ on major activity. This looks like noise in the generated data. Acting on it would stop every applicant.

**"Today" is 2026-07-15.** Inject it through a `Clock` set by `APP_TODAY`, never `new Date()`. The 90-day cutoff is 2026-04-16.

## Verdicts

| Verdict | Meaning | Owner sees |
|---|---|---|
| `VERIFIED` | All hard checks pass | "You're verified", then the next step |
| `RETAKE` | A document is unreadable or missing | Exactly which document and how to fix it |
| `NEEDS_CONFIRMATION` | A field that couldn't be read, or a GSTIN that failed the checksum or lookup | The value, to confirm or correct |
| `VERIFICATION_PENDING` | A required registry lookup is down | "We'll finish this shortly", and the owner can leave and come back |
| `MANUAL_REVIEW` | Soft-check failures only, or a mismatch with an innocent explanation | "We're checking this, usually within X" |
| `REJECTED` | Hard failure the owner can't fix by re-uploading | The specific reason and what to do next |

Messages never reveal which registry record would have matched, and never accuse anyone of fraud.

## Specimen test fixtures

This is our own reading of the specimens, **not the judges' answer key**.

| Applicant | Business | Expected result | Check |
|---|---|---|---|
| K01 | Vindhya Tours & Travels | `REJECTED` for GSTIN-required bundles | `GST_STATUS` Cancelled; Udyam certificate has no number and no registry entry |
| K02 | Harmony Dental Care | `VERIFIED` after deskew | Skewed scan, O/0 repair |
| K03 | Ganesh Woodcraft | `VERIFIED` | No problem found |
| K04 | Saffron Dental Care LLP | `RETAKE` | GST certificate blurred |
| K05 | Balaji Realty LLP | `VERIFIED` | Udyam certificate missing; the registry fills the gap |
| K06 | Saffron Unisex Salon | `NEEDS_CONFIRMATION`, then `REJECTED` | `GST_FORMAT` altered digit; not in registry |
| K07 | Neelgiri Physio Clinic | `MANUAL_REVIEW` | `GST_NAME` says Shri Physio Clinic |
| K08 | Green Leaf Legal Associates | `VERIFIED` | No problem found |
| K09 | Kaveri Insurance Advisors | `VERIFIED` | No problem found |
| K10 | Kaveri Stays LLP | `NEEDS_CONFIRMATION` from an OCR misread, then `MANUAL_REVIEW` | `SIGNATORY_NAME`: ID says Nisha Arora, contact is Fatima Menon |
| K11 | Trinity Bake House Pvt Ltd | `RETAKE` | `ADDRESS_AGE`: bill dated 2025-10-31, 257 days old |
| K12 | Star Electronics | `VERIFIED` | No problem found |

Applicants map to leads by business name and city, for example K01 is L00045. `tests/fixtures/kyc/specimens.json` holds real OCR output and the lead details, and `tests/regression/kyc-specimens.test.ts` holds the expected results.

## Data handling

- Mask identifiers everywhere: UI, logs and analytics. Show `32TTN•••••••1ZW`, and only the last 4 digits for ID numbers.
- Never log raw OCR text or document contents.
- Treat OCR text as untrusted data. It must never reach an LLM as instructions.
- Delete the raw image once extraction and verification finish, on the schedule in the privacy note.
- Never build the app around the watermark or the "SYN-ID" prefix. Real documents won't have them.

## Tests

- Unit: regex, checksum, repair, normalisers, address joining and date checks at 90 and 91 days.
- Fixture: K01 to K12 through the whole pipeline with mocked OCR output, asserting exact check IDs. Add a live OCR accuracy report separately.
- Integration: registry 200, 404, 400 and 503; consent missing returns 403; duplicate uploads are idempotent.
- E2E: an upload-to-verdict flow at 360 px in Hindi and in English.
