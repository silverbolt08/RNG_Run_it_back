# OCR accuracy test

Run on 2026-11-04 for Phase 0 of the [blueprint](../blueprint.md). The scripts were throwaway. The live OCR report in Phase 6 replaces this one.

## Result

`tesseract.js` 7 is accurate enough to keep as the local OCR engine for the provided specimens. It read **96.8%** of fields correctly with no repair, above the proposed 90% bar. Repairing GSTINs by character position raises that to **99.2%**.

Phone photos are untested, so these figures apply only to the clean digital specimens.

| Setup | Fields correct | Notes |
|---|---|---|
| **No filter, auto-rotate** | **243 of 251 (96.8%)** | Chosen setup |
| Chosen setup plus GSTIN repair | 249 of 251 (99.2%) | Repair is a separate step after OCR |
| No filter, no rotation | 240 of 251 (95.6%) | K02's rotated certificate fails |
| Gentle watermark filter, auto-rotate | 243 of 251 (96.8%) | No gain over no filter |
| Hard watermark filter, no rotation | 194 of 251 (77.3%) | Removes parts of characters |
| Hard watermark filter, auto-rotate | 195 of 251 (77.7%) | Removes parts of characters |

By document type, the chosen setup with no repair scored:

| Document | Fields correct |
|---|---|
| GST certificate | 69 of 77 |
| Udyam certificate | 66 of 66 |
| Signatory ID | 60 of 60 |
| Address proof | 48 of 48 |

The 8 GST misses are all GSTINs. The other GST fields had no errors.

## Other measurements

| Check | Result |
|---|---|
| Speed | Median 0.8 s per image, 1.2 s at most, with one worker on this laptop. A worker takes about 0.8 s to start. Hosted speed is untested. |
| Blur | K04's GST certificate scores 1 on variance of the Laplacian. Every other specimen scores 433 or more. |
| Skew | Auto-rotation measured -6.9° on K02's GST certificate and rotated no other image. |
| Language data | `tesseract.js` downloaded a 5.2 MB English language file on first run. It must be bundled for the local-processing claim to hold. |

## What this changes

1. **Don't filter the watermark.** This reverses the earlier guidance in `smart-kyc`. The filter removed parts of digits where the watermark crosses them.
2. **Use `tesseract.js` auto-rotation** rather than writing a skew estimator.
3. **Extend GSTIN repair.** Position 14 is always `Z`, and OCR often reads it as `7`. Six of the eight GSTIN misses were fixed by repair, with no registry GSTIN changed by it (0 of 3,534).
4. **Never reject on a checksum failure straight away.** See below.

## The K10 problem

Two GSTIN misses remain after repair:

| Applicant | Miss | Effect |
|---|---|---|
| K06 | The check character reads `0` for `O` | None. The planted fault fails the checksum either way. |
| K10 | Position 5 reads `I` for `J` | Fails the checksum, though K10's GSTIN is valid. |

K10's misread and K06's planted fault look identical to the pipeline, because both fail the checksum. Rejecting on that failure alone would wrongly reject K10 and hide its real issue, the signatory mismatch.

A second read could not separate them. Reading the row at 2, 3 and 4 times the size still gave `I`, made other GSTINs worse in places, and gave confidence scores no different from correct reads.

**The rule:** a checksum failure on an OCR value returns `NEEDS_CONFIRMATION`. The owner sees what was read, with at most one look-alike suggestion that passes the checksum, and checks it against their certificate. The normal registry lookup then runs on what they confirm.

| Applicant | Look-alike test | Outcome |
|---|---|---|
| K10 | One candidate, position 5 `I` to `J`, found in the registry | Continues to the signatory check |
| K06 read with `0` | No candidate | Rejected |
| K06 read with `O` | One candidate passes the checksum but isn't in the registry | Rejected |

Suggestions are built without using the registry, so we never repair towards a registry value. As a further check, 2,000 random one-letter slips in registry GSTINs all failed the checksum.

## Found while building the upload pipeline

Added on 2026-11-04, in Phase 3. The spike read the original PNG files. Those have no density tag, so Tesseract estimates the resolution from the page. Re-encoding through `sharp` to strip EXIF adds a 72 dpi `pHYs` tag, and Tesseract believes it.

On K02's GST certificate, that tag made auto-rotation measure 0° instead of -6.9° and garbled the GSTIN. The pixels were identical. The other specimens read the same either way.

| Input to OCR (K02) | Skew measured | GSTIN row |
|---|---|---|
| Original file, no tag | -6.9° | `19E0GXH4115Y1ZL` |
| `sharp` PNG, 72 dpi tag | 0° | `19606 #41157, 7,` |
| `sharp` PNG, 96 dpi tag | -7.2° | `19E0GXH4115Y1ZL` |
| `sharp` PNG, 300 dpi tag | -7.0° | `19E0GXH4115Y1ZL` |
| `sharp` JPEG, quality 90 | -7.0° | `19E0GXH4115Y1ZL` |

`src/server/adapters/images/upload-validation.ts` now removes the tag from re-encoded PNGs, matching what the spike measured. Phone photos will arrive as JPEGs carrying their own density values, so test those in Phase 6.

## How the fields were scored

- **Registry-backed fields:** GST certificates and bill names and addresses were compared with `mock_gstin_registry.csv`, and planted values were recorded as printed. K06's fields were matched to its registry row by name and address, because its printed GSTIN isn't in the registry.
- **Other fields:** signatory IDs, Udyam certificates, consumer numbers and bill dates were compared by eye with the specimens. That check found no differences, so these fields are 100% by a single reader's check, not by an independent key.
- **Excluded:** K04's blurred GST certificate (7 fields), which the quality gate stops before OCR.
- **Matching:** identifiers and dates had to match exactly. Names and addresses were compared on letters and digits only.

## Limits

- **One font and clean digital images.** Real phone photos will be harder. Test photos of the specimens in Phase 6, and recalibrate the blur threshold on them.
- **Our own reading of the specimens,** not the judges' answer key.
- **Field extraction only.** The verdict logic isn't built yet.
