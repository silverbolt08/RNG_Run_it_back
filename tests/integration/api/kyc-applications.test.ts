import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, expectApiError, grant, newVisitor, verifyPhone } from '../../helpers/api-client';
import { passwordProtectedPdf, textPdf } from '../../helpers/pdf-fixtures';
import { blurredImage, createTestApp, documentImage, type TestApp } from '../../helpers/test-app';
import {
  acceptedQuote,
  ACTIVE_PROFILE,
  applicant,
  noGstinLines,
  ocrGstin,
  postDocument,
  seedRegistryFor,
  uploadAll,
  uploadSpecimen,
} from '../../helpers/specimens';

const APPLICATIONS = '/api/v1/kyc-applications';

describe('KYC applications', () => {
  let app: TestApp;
  let owner: ApiClient;

  beforeEach(async () => {
    app = await createTestApp();
    owner = await newVisitor();
  });
  afterEach(() => app.dispose());

  const start = async (key: string, extra: object = {}) => {
    const quoteId = await acceptedQuote(owner);
    const response = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, contactName: applicant(key).contactName, ...extra });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { quoteId, id: response.body.id as string, application: response.body };
  };

  const checkOf = (view: { checks: Array<{ id: string }> }, id: string) => view.checks.find((check) => check.id === id);

  const storedFiles = () => {
    try {
      return readdirSync(app.documentDir);
    } catch {
      return [];
    }
  };

  describe('creating', () => {
    it('refuses without consent', async () => {
      const response = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId: 'qt_anything' });
      expectApiError(response, 403, 'CONSENT_REQUIRED');
      expect(response.body.error.details).toEqual({ purpose: 'kyc_verification' });
    });

    it("hides another owner's quote behind a 404", async () => {
      const quoteId = await acceptedQuote(owner);
      const other = await newVisitor();
      await grant(other, 'kyc_verification');
      expectApiError(await other.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId }), 404, 'NOT_FOUND');
    });

    it('needs an accepted quote', async () => {
      await grant(owner, 'advisor_profile');
      await grant(owner, 'kyc_verification');
      const quote = await owner.post('/api/v1/quotes', { profile: ACTIVE_PROFILE, lines: noGstinLines });
      expectApiError(await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId: quote.body.id }), 409, 'QUOTE_NOT_ACCEPTED');
    });

    it('rejects unknown fields', async () => {
      const quoteId = await acceptedQuote(owner);
      expectApiError(await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, dateOfBirth: '1990-01-01' }), 400, 'INVALID_REQUEST');
    });

    it('returns the open application if asked twice for the same quote', async () => {
      const { id, quoteId } = await start('K03');
      const again = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId });
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(id);
    });

    it('asks only for the documents this bundle needs', async () => {
      const { application } = await start('K03');
      expect(application.requiredDocuments).toEqual(['GST_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF']);
      expect(application.missingDocuments).toEqual(['GST_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF']);
      expect(application.status).toBe('OPEN');
      expect(application.verdict).toBeNull();
      expect(application.nextActions).toContain('UPLOAD_DOCUMENTS');

      const other = await newVisitor();
      const quoteId = await acceptedQuote(other, noGstinLines, ACTIVE_PROFILE, '9000000002');
      const response = await other.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, contactName: 'Asha Rao' });
      expect(response.body.requiredDocuments).toEqual(['SIGNATORY_ID', 'ADDRESS_PROOF']);
    });

    it('keeps the contact name, labelled as the owner typed it', async () => {
      const { application } = await start('K03');
      expect(application.contact).toEqual({ name: applicant('K03').contactName, source: 'OWNER' });
    });

    it('asks for a contact name when it has none', async () => {
      const quoteId = await acceptedQuote(owner);
      const response = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId });
      expect(response.body.contact).toEqual({ name: null, source: null });
      expect(response.body.nextActions).toContain('PROVIDE_CONTACT_NAME');
    });

    it('reveals nothing about a lead when someone only types its GSTIN', async () => {
      await seedRegistryFor(app, 'K03');
      const quoteId = await acceptedQuote(owner);
      const response = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, gstin: applicant('K03').gstinOnFile });
      expect(response.body.contact).toEqual({ name: null, source: null });
      expect(JSON.stringify(response.body)).not.toContain(applicant('K03').contactName);
    });

    it('uses the name on file only after a matching certificate, and never shows it', async () => {
      await seedRegistryFor(app, 'K03');
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId });
      const uploaded = await uploadSpecimen(app, owner, created.body.id, 'K03', 'GST_CERTIFICATE');
      expect(uploaded.body.application.contact).toEqual({ name: null, source: 'LEAD_PREFILL' });
      expect(uploaded.body.application.nextActions).not.toContain('PROVIDE_CONTACT_NAME');
      expect(JSON.stringify(uploaded.body)).not.toContain(applicant('K03').contactName);
    });

    it('does not prefill from a GSTIN that matches nothing', async () => {
      const quoteId = await acceptedQuote(owner);
      const response = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, gstin: '29AAAAA0000A1ZY' });
      expect(response.body.contact).toEqual({ name: null, source: null });
    });

    it('lets the owner correct a prefilled name', async () => {
      await seedRegistryFor(app, 'K03');
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, gstin: applicant('K03').gstinOnFile });
      const updated = await owner.put(`${APPLICATIONS}/${created.body.id}/contact`, { contactName: 'Corrected Name' });
      expect(updated.status).toBe(200);
      expect(updated.body.contact).toEqual({ name: 'Corrected Name', source: 'OWNER' });
    });

    it('keeps names and identifiers out of plain database columns', async () => {
      const person = applicant('K03');
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03', { gstin: person.gstinOnFile });
      await uploadAll(app, owner, id, 'K03');

      for (const table of ['kyc_applications', 'kyc_documents', 'kyc_checks']) {
        const rows = JSON.stringify((await app.testDb.client.execute(`SELECT * FROM ${table}`)).rows);
        expect(rows, table).not.toContain(person.contactName);
        expect(rows, table).not.toContain(person.gstinOnFile);
        expect(rows, table).not.toContain(person.businessName);
      }
    });

    it('rate limits GSTIN lookups, so they cannot enumerate businesses', async () => {
      const { quoteId } = await start('K03');
      let last = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, gstin: '29AAAAA0000A1ZY' });
      for (let i = 0; i < 20; i++) last = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, gstin: '29AAAAA0000A1ZY' });
      expectApiError(last, 429, 'RATE_LIMITED');
    });
  });

  describe('ownership', () => {
    it("hides another owner's application behind a 404 on every route", async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      const other = await newVisitor();
      await grant(other, 'kyc_verification');

      const image = await documentImage();
      expectApiError(await other.get(`${APPLICATIONS}/${id}`), 404, 'NOT_FOUND');
      expectApiError(await postDocument(other, id, 'SIGNATORY_ID', image), 404, 'NOT_FOUND');
      expectApiError(await other.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: '29AAAAA0000A1ZY' }), 404, 'NOT_FOUND');
      expectApiError(await other.post(`${APPLICATIONS}/${id}/reassessment`), 404, 'NOT_FOUND');
      expectApiError(await other.put(`${APPLICATIONS}/${id}/contact`, { contactName: 'Someone Else' }), 404, 'NOT_FOUND');
      expect(storedFiles()).toEqual([]);
    });
  });

  describe('uploading', () => {
    it('stores nothing and reads nothing without consent', async () => {
      const { id } = await start('K03');
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      const before = app.stubOcr.calls;

      const response = await postDocument(owner, id, 'SIGNATORY_ID', await documentImage());
      expectApiError(response, 403, 'CONSENT_REQUIRED');
      expect(app.stubOcr.calls).toBe(before);
      expect(storedFiles()).toEqual([]);
    });

    it('stores nothing for a visitor who never consented', async () => {
      const stranger = await newVisitor();
      const response = await postDocument(stranger, 'kyc_anything', 'SIGNATORY_ID', await documentImage());
      expectApiError(response, 403, 'CONSENT_REQUIRED');
      expect(storedFiles()).toEqual([]);
      const rows = await app.testDb.client.execute('SELECT COUNT(*) AS total FROM kyc_documents');
      expect(Number(rows.rows[0]?.total)).toBe(0);
    });

    it('needs an idempotency key', async () => {
      const { id } = await start('K03');
      const form = new FormData();
      form.set('documentType', 'SIGNATORY_ID');
      form.set('file', new File([new Uint8Array(await documentImage())], 'a.png'));
      const response = await owner.request('POST', `${APPLICATIONS}/${id}/documents`, { form });
      expectApiError(response, 400, 'INVALID_REQUEST');
    });

    it('rejects an unknown document type, a missing file and unknown fields', async () => {
      const { id } = await start('K03');
      const image = await documentImage();
      expectApiError(await postDocument(owner, id, 'PASSPORT', image), 400, 'INVALID_REQUEST');

      const noFile = new FormData();
      noFile.set('documentType', 'SIGNATORY_ID');
      const headers = { 'idempotency-key': 'missing-file-key' };
      expectApiError(await owner.request('POST', `${APPLICATIONS}/${id}/documents`, { form: noFile, headers }), 400, 'INVALID_REQUEST');

      const extra = new FormData();
      extra.set('documentType', 'SIGNATORY_ID');
      extra.set('file', new File([new Uint8Array(image)], 'a.png'));
      extra.set('dateOfBirth', '1990-01-01');
      expectApiError(await owner.request('POST', `${APPLICATIONS}/${id}/documents`, { form: extra, headers }), 400, 'INVALID_REQUEST');
    });

    it('asks for an unlocked copy of a password-protected PDF', async () => {
      const { id } = await start('K03');
      expectApiError(await postDocument(owner, id, 'SIGNATORY_ID', passwordProtectedPdf()), 422, 'PDF_PROTECTED');
      expect(storedFiles()).toEqual([]);
    });

    it('reads a PDF like any other document, storing only the image of its first page', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      const person = applicant('K03');
      app.stubOcr.willRead(person.documents.signatory?.text ?? '');

      const response = await postDocument(owner, id, 'SIGNATORY_ID', textPdf(['A signatory ID as a PDF', 'FICTIONAL-MARKER-TEXT']));
      expect(response.status).toBe(201);
      expect(response.body.document.quality).toBe('OK');
      expect(storedFiles()).toHaveLength(1);
    });

    it('rejects a broken PDF with a clear 422, keeping progress', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      await uploadSpecimen(app, owner, id, 'K03', 'SIGNATORY_ID');

      const response = await postDocument(owner, id, 'ADDRESS_PROOF', Buffer.from('%PDF-1.7 fake'));
      expectApiError(response, 422, 'PDF_UNREADABLE');

      const read = await owner.get(`${APPLICATIONS}/${id}`);
      expect(read.body.documents.map((doc: { documentType: string }) => doc.documentType)).toEqual(['SIGNATORY_ID']);
    });

    it.each([
      ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'UNSUPPORTED_FILE_TYPE'],
      ['HTML', '<html></html>', 'UNSUPPORTED_FILE_TYPE'],
    ])('rejects %s by its content', async (_label, content, code) => {
      const { id } = await start('K03');
      expectApiError(await postDocument(owner, id, 'SIGNATORY_ID', Buffer.from(content)), 422, code);
      expect(storedFiles()).toEqual([]);
    });

    it('accepts JPEG as well as PNG', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      app.stubOcr.willRead(applicant('K03').documents.signatory?.text ?? '');
      const response = await postDocument(owner, id, 'SIGNATORY_ID', await documentImage('jpeg'));
      expect(response.status).toBe(201);
      expect(response.body.document.quality).toBe('OK');
    });

    it('asks for a retake of a blurred photo, without running OCR or keeping the file', async () => {
      const { id } = await start('K04');
      const before = app.stubOcr.calls;
      const response = await uploadSpecimen(app, owner, id, 'K04', 'GST_CERTIFICATE');
      expect(response.status).toBe(201);
      expect(response.body.document.quality).toBe('BLURRED');
      expect(app.stubOcr.calls).toBe(before);
      expect(storedFiles()).toEqual([]);
      expect(response.body.application.nextActions).toContain('RETAKE_DOCUMENT');
    });

    it('names what it found when the wrong document is in a slot', async () => {
      const { id } = await start('K03');
      app.stubOcr.willRead(applicant('K03').documents.signatory?.text ?? '');
      const response = await postDocument(owner, id, 'GST_CERTIFICATE', await documentImage());
      expect(response.body.document).toMatchObject({ quality: 'WRONG_TYPE', detectedType: 'SIGNATORY_ID' });
      expect(storedFiles()).toEqual([]);
    });

    it('treats a page with no readable labels as unreadable', async () => {
      const { id } = await start('K03');
      app.stubOcr.willRead('');
      const response = await postDocument(owner, id, 'SIGNATORY_ID', await documentImage());
      expect(response.body.document.quality).toBe('UNREADABLE');
      expect(storedFiles()).toEqual([]);
    });

    it('stores a readable document encrypted, and never the OCR text', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      const response = await uploadSpecimen(app, owner, id, 'K03', 'SIGNATORY_ID');
      expect(response.status).toBe(201);
      expect(storedFiles()).toHaveLength(1);
      const rows = JSON.stringify((await app.testDb.client.execute('SELECT * FROM kyc_documents')).rows);
      expect(rows).not.toContain('Authorised Signatory');
      expect(rows).not.toContain('SYN-ID');
    });

    it('creates nothing new when the same upload is repeated with the same key', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      const image = await documentImage();
      app.stubOcr.willRead(applicant('K03').documents.signatory?.text ?? '');

      const first = await postDocument(owner, id, 'SIGNATORY_ID', image, 'repeat-key-0001');
      const calls = app.stubOcr.calls;
      const second = await postDocument(owner, id, 'SIGNATORY_ID', image, 'repeat-key-0001');

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.document.id).toBe(first.body.document.id);
      expect(second.body.replayed).toBe(true);
      expect(app.stubOcr.calls).toBe(calls);
      expect(storedFiles()).toHaveLength(1);
      const rows = await app.testDb.client.execute('SELECT COUNT(*) AS total FROM kyc_documents');
      expect(Number(rows.rows[0]?.total)).toBe(1);
    });

    it('refuses the same key with a different file', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      app.stubOcr.willRead(applicant('K03').documents.signatory?.text ?? '');
      await postDocument(owner, id, 'SIGNATORY_ID', await documentImage(), 'repeat-key-0002');
      const response = await postDocument(owner, id, 'SIGNATORY_ID', await documentImage(), 'repeat-key-0002');
      expectApiError(response, 409, 'IDEMPOTENCY_KEY_REUSED');
    });

    it('keeps a document uploaded during an OCR outage and reads it once OCR is back', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      const person = applicant('K03');

      app.stubOcr.failing = true;
      const during = await postDocument(owner, id, 'SIGNATORY_ID', await documentImage(), 'outage-key-0001');
      expect(during.status).toBe(201);
      expect(during.body.document.quality).toBe('PENDING_READ');
      expect(during.body.application.nextActions).not.toContain('RETAKE_DOCUMENT');
      expect(storedFiles()).toHaveLength(1);

      // Everything else goes in too, so the owner is done and only OCR is holding things up.
      await postDocument(owner, id, 'GST_CERTIFICATE', await documentImage(), 'outage-key-0002');
      const last = await postDocument(owner, id, 'ADDRESS_PROOF', await documentImage(), 'outage-key-0003');
      expect(last.body.application.verdict).toBe('VERIFICATION_PENDING');
      expect(last.body.application.nextActions).toContain('RETRY_VERIFICATION');

      const stillDown = await owner.post(`${APPLICATIONS}/${id}/reassessment`, {});
      expect(stillDown.status).toBe(200);
      expect(stillDown.body.verdict).toBe('VERIFICATION_PENDING');

      app.stubOcr.failing = false;
      // Read in upload order, which is the order the stored documents are retried in.
      app.stubOcr.willRead(
        person.documents.signatory?.text ?? '',
        person.documents.gst?.text ?? '',
        person.documents.addressProof?.text ?? '',
      );
      const after = await owner.post(`${APPLICATIONS}/${id}/reassessment`, {});
      expect(after.status).toBe(200);
      expect(after.body.documents.map((doc: { quality: string }) => doc.quality)).toEqual(['OK', 'OK', 'OK']);
      expect(after.body.verdict).toBe('VERIFIED');
    });

    it('runs a blurred photo past the quality gate even during an OCR outage', async () => {
      const { id } = await start('K03');
      app.stubOcr.failing = true;
      const response = await postDocument(owner, id, 'SIGNATORY_ID', await blurredImage(), 'outage-blur-0001');
      expect(response.body.document.quality).toBe('BLURRED');
      expect(storedFiles()).toEqual([]);
    });

    it('replaces an earlier document of the same type, deleting its file', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      await uploadSpecimen(app, owner, id, 'K03', 'SIGNATORY_ID');
      const first = storedFiles();
      await uploadSpecimen(app, owner, id, 'K03', 'SIGNATORY_ID');
      const second = storedFiles();
      expect(second).toHaveLength(1);
      expect(second[0]).not.toBe(first[0]);

      const read = await owner.get(`${APPLICATIONS}/${id}`);
      expect(read.body.documents).toHaveLength(1);
    });

    it('rate limits uploads', async () => {
      const { id } = await start('K03');
      // Bytes that are refused at once, so the test measures the limit and not the reading.
      const notAnImage = Buffer.from('not an image');
      let last = await postDocument(owner, id, 'SIGNATORY_ID', notAnImage);
      for (let i = 0; i < 35; i++) last = await postDocument(owner, id, 'SIGNATORY_ID', notAnImage);
      expectApiError(last, 429, 'RATE_LIMITED');
    });
  });

  describe('verdicts', () => {
    it('K03 is verified, with identifiers masked', async () => {
      const person = applicant('K03');
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');

      const response = await uploadAll(app, owner, id, 'K03');
      const view = response.body.application;
      expect(view.verdict).toBe('VERIFIED');
      expect(view.missingDocuments).toEqual([]);
      expect(view.nextActions).toEqual(['PLACE_ORDER']);
      expect(view.verifiedAt).toEqual(expect.any(String));
      expect(view.gstin.masked).toMatch(/^27XUI•+1ZP$/);
      expect(view.gstin.confirmation).toBeNull();
      expect(JSON.stringify(view)).not.toContain(person.gstinOnFile);
      expect(JSON.stringify(view)).not.toContain(person.udyamNumberOnFile);
    });

    it('holds the verdict until every required document is in', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      const first = await uploadSpecimen(app, owner, id, 'K03', 'GST_CERTIFICATE');
      expect(first.body.application.verdict).toBeNull();
      expect(first.body.application.missingDocuments).toEqual(['SIGNATORY_ID', 'ADDRESS_PROOF']);
    });

    it('will not verify without a contact name to check the signatory against', async () => {
      await seedRegistryFor(app, 'K03');
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId });
      const uploaded = await uploadAll(app, owner, created.body.id, 'K03');
      // The GSTIN on the certificate matched a lead, so the name was prefilled for the owner to check.
      expect(uploaded.body.application.contact).toEqual({ name: null, source: 'LEAD_PREFILL' });
      expect(uploaded.body.application.verdict).toBe('VERIFIED');
    });

    it('holds the verdict when no name can be found at all', async () => {
      await addRegistryWithoutLead();
      const quoteId = await acceptedQuote(owner);
      const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId });
      const uploaded = await uploadAll(app, owner, created.body.id, 'K03');
      expect(uploaded.body.application.verdict).toBeNull();
      expect(uploaded.body.application.nextActions).toContain('PROVIDE_CONTACT_NAME');

      const named = await owner.put(`${APPLICATIONS}/${created.body.id}/contact`, {
        contactName: applicant('K03').contactName,
      });
      expect(named.body.verdict).toBe('VERIFIED');
    });

    async function addRegistryWithoutLead() {
      await seedRegistryFor(app, 'K03');
      await app.testDb.client.execute('DELETE FROM leads');
    }

    it('K04 is asked to retake its blurred GST certificate', async () => {
      await seedRegistryFor(app, 'K04');
      const { id } = await start('K04');
      const { body } = await uploadAll(app, owner, id, 'K04');
      expect(body.application.verdict).toBe('RETAKE');
      expect(checkOf(body.application, 'GST_DOCUMENT')).toMatchObject({
        outcome: 'FAIL',
        evidence: { problem: 'BLURRED' },
      });
    });

    it('K05 is verified without a Udyam certificate, because the registry fills the gap', async () => {
      await seedRegistryFor(app, 'K05');
      const { id } = await start('K05');
      const { body } = await uploadAll(app, owner, id, 'K05');
      expect(body.application.verdict).toBe('VERIFIED');
      expect(checkOf(body.application, 'UDYAM_PRESENT')).toMatchObject({ outcome: 'PASS', evidence: { source: 'REGISTRY' } });
    });

    it('K11 is asked for a newer bill, and is verified once it sends one', async () => {
      await seedRegistryFor(app, 'K11');
      const { id } = await start('K11');
      const { body } = await uploadAll(app, owner, id, 'K11');
      expect(body.application.verdict).toBe('RETAKE');
      expect(checkOf(body.application, 'ADDRESS_AGE')).toMatchObject({ outcome: 'FAIL', evidence: { ageDays: '257' } });
      expect(body.application.nextActions).toContain('RETAKE_DOCUMENT');

      const newBill = (applicant('K11').documents.addressProof?.text ?? '').replace('2025-10-31', '2026-07-01');
      app.stubOcr.willRead(newBill);
      const retaken = await postDocument(owner, id, 'ADDRESS_PROOF', await documentImage());
      expect(retaken.body.application.verdict).toBe('VERIFIED');
    });

    it('K07 goes to manual review, and nothing about it is called fraud', async () => {
      await seedRegistryFor(app, 'K07');
      await app.testDb.client.execute({
        sql: 'UPDATE gst_registry SET trade_name = ?, legal_name = ? WHERE id = ?',
        args: ['Neelgiri Physio Clinic', 'Neelgiri Physio Clinic', applicant('K07').gstinOnFile],
      });
      const { id } = await start('K07');
      const { body } = await uploadAll(app, owner, id, 'K07');
      expect(body.application.verdict).toBe('MANUAL_REVIEW');
      expect(checkOf(body.application, 'GST_NAME')).toMatchObject({ outcome: 'FAIL' });
      expect(body.application.nextActions).toEqual(['PLACE_ORDER']);
    });

    describe('confirming a GSTIN', () => {
      it('K10 shows what was read and one suggestion, in full, for the owner to check', async () => {
        await seedRegistryFor(app, 'K10');
        const { id } = await start('K10');
        const { body } = await uploadAll(app, owner, id, 'K10');
        expect(body.application.verdict).toBe('NEEDS_CONFIRMATION');
        expect(body.application.nextActions).toContain('CONFIRM_GSTIN');
        expect(body.application.gstin.confirmation).toEqual({
          read: ocrGstin('K10'),
          suggestion: applicant('K10').gstinOnFile,
        });
      });

      it('refuses a confirmation nobody asked for, so a rejection cannot be talked away', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const { id } = await start('K01');
        const { body } = await uploadAll(app, owner, id, 'K01');
        expect(body.application.verdict).toBe('REJECTED');

        const stranger = applicant('K02').gstinOnFile;
        const response = await owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: stranger });
        expectApiError(response, 409, 'CONFIRMATION_NOT_REQUESTED');
        expect((await owner.get(`${APPLICATIONS}/${id}`)).body.verdict).toBe('REJECTED');
      });

      it('refuses a number too different from what was read, so a stranger cannot be looked up', async () => {
        await seedRegistryFor(app, 'K10');
        await seedRegistryFor(app, 'K02');
        const { id } = await start('K10');
        await uploadAll(app, owner, id, 'K10');

        const response = await owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: applicant('K02').gstinOnFile });
        expectApiError(response, 422, 'GSTIN_TOO_DIFFERENT');
        expect(JSON.stringify(response.body)).not.toContain('Active');
      });

      it('says nothing about a typed number until a document is in', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const quoteId = await acceptedQuote(owner);
        const response = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, gstin: applicant('K01').gstinOnFile });
        expect(response.body.verdict).toBeNull();
        expect(response.body.checks).toEqual([]);
      });

      it('asks for a retake of a blurred certificate, even when the bundle needs no GSTIN', async () => {
        await seedRegistryFor(app, 'K04');
        const quoteId = await acceptedQuote(owner, noGstinLines);
        const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, contactName: applicant('K04').contactName });
        const { body } = await uploadAll(app, owner, created.body.id, 'K04');
        expect(body.application.verdict).toBe('RETAKE');
        expect(body.application.nextActions).not.toContain('PLACE_ORDER');
      });

      it('requires the adult declaration', async () => {
        const quoteId = await acceptedQuote(owner);
        expectApiError(await owner.post(APPLICATIONS, { quoteId, contactName: 'Some Person' }), 400, 'INVALID_REQUEST');
      });

      it('keeps no ID number, designation or consumer number', async () => {
        await seedRegistryFor(app, 'K03');
        const { id } = await start('K03');
        await uploadAll(app, owner, id, 'K03');
        const rows = await app.testDb.client.execute(`SELECT sealed_fields FROM kyc_documents WHERE document_type IN ('SIGNATORY_ID', 'ADDRESS_PROOF')`);
        expect(rows.rows).toHaveLength(2);
        const { kycDocuments } = await import('@/server/db/schema');
        const { fieldsContext } = await import('@/server/services/kyc/kyc-repository');
        const documents = await app.db.select().from(kycDocuments);
        for (const document of documents) {
          if (!document.sealedFields) continue;
          const fields = app.sealer.openJson<Record<string, string>>(document.sealedFields, fieldsContext(document.id));
          for (const key of ['idNumber', 'designation', 'consumerNumber']) expect(fields[key] ?? '').toBe('');
        }
      });

      it('K10 reaches its real issue once the owner confirms the suggestion, and masks it again', async () => {
        await seedRegistryFor(app, 'K10');
        const { id } = await start('K10');
        await uploadAll(app, owner, id, 'K10');

        const confirmed = await owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: applicant('K10').gstinOnFile });
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.verdict).toBe('MANUAL_REVIEW');
        expect(checkOf(confirmed.body, 'SIGNATORY_NAME')).toMatchObject({ outcome: 'FAIL' });
        expect(confirmed.body.gstin.confirmation).toBeNull();
        expect(confirmed.body.gstin.confirmedByOwner).toBe(true);
        expect(JSON.stringify(confirmed.body)).not.toContain(applicant('K10').gstinOnFile);
      });

      it('K06 is rejected once the owner confirms the printed number, offering the quote change', async () => {
        await seedRegistryFor(app, 'K06');
        const { id } = await start('K06');
        const { body } = await uploadAll(app, owner, id, 'K06');
        expect(body.application.verdict).toBe('NEEDS_CONFIRMATION');

        const confirmed = await owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: '08YKZXS8189L1ZO' });
        expect(confirmed.body.verdict).toBe('REJECTED');
        expect(checkOf(confirmed.body, 'GST_FORMAT')).toMatchObject({ outcome: 'FAIL', onFail: 'REJECTED' });
        expect(confirmed.body.quoteChange.requiresAcceptance).toBe(true);
      });

      it('asks the owner to check a valid number the registry does not know, then rejects it once confirmed', async () => {
        const { id } = await start('K03');
        const unknownGstin = '29AAAAA0000A1ZY';
        const text = (applicant('K03').documents.gst?.text ?? '').replace(/GSTIN \S+/, `GSTIN ${unknownGstin}`);
        app.stubOcr.willRead(text);
        const uploaded = await postDocument(owner, id, 'GST_CERTIFICATE', await documentImage());
        expect(uploaded.body.application.gstin.confirmation).toEqual({ read: unknownGstin, suggestion: null });
        expect(uploaded.body.application.nextActions).toContain('CONFIRM_GSTIN');

        const confirmed = await owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: unknownGstin });
        expect(confirmed.body.verdict).toBe('REJECTED');
        expect(checkOf(confirmed.body, 'GST_FOUND')).toMatchObject({ outcome: 'FAIL', onFail: 'REJECTED' });
        expect(confirmed.body.quoteChange).toMatchObject({ gstinStatus: 'NONE', requiresAcceptance: true });
        expect(JSON.stringify(confirmed.body)).not.toContain(unknownGstin);
      });

      it('rejects junk with a 400', async () => {
        const { id } = await start('K03');
        expectApiError(await owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: 'short' }), 400, 'INVALID_REQUEST');
      });

      it('rate limits confirmations', async () => {
        const { id } = await start('K03');
        const confirm = () => owner.post(`${APPLICATIONS}/${id}/gstin-confirmation`, { gstin: '29AAAAA0000A1ZY' });
        let last = await confirm();
        for (let i = 0; i < 20; i++) last = await confirm();
        expectApiError(last, 429, 'RATE_LIMITED');
      });
    });

    describe('when the verdict changes the quote', () => {
      it('K01 is rejected for this bundle, and shows exactly what changed', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const { id, quoteId } = await start('K01');
        const { body } = await uploadAll(app, owner, id, 'K01');
        const view = body.application;

        expect(view.verdict).toBe('REJECTED');
        expect(checkOf(view, 'GST_STATUS')).toMatchObject({ outcome: 'FAIL', evidence: { status: 'Cancelled' } });
        expect(view.quoteChange).toMatchObject({
          reason: 'GSTIN_STATUS',
          gstinStatus: 'CANCELLED',
          requiresAcceptance: true,
        });
        expect(view.quoteChange.dropped[0]).toMatchObject({ productId: 'P15', name: 'WhatsApp Business API Starter' });
        expect(view.quoteChange.dropped[0].blockers[0].rule).toBe('GSTIN_REQUIRED');
        expect(view.quoteChange.comparison.monthlyDeltaInr).toBeLessThan(0);
        expect(view.nextActions).toContain('ACCEPT_NEW_QUOTE');

        const quote = await owner.get(`/api/v1/quotes/${quoteId}`);
        expect(quote.body.status).toBe('NEEDS_ACCEPTANCE');
        expect(quote.body.lines.map((line: { productId: string }) => line.productId)).toEqual(['P01']);
        expect(quote.body.profile.gstinStatus).toBe('CANCELLED');
      });

      it('K01 cannot place an order until it accepts the new quote', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const { id, quoteId } = await start('K01');
        await uploadAll(app, owner, id, 'K01');
        const order = await owner.post('/api/v1/orders', { quoteId, kycApplicationId: id }, { headers: { 'idempotency-key': 'order-key-0001' } });
        expectApiError(order, 409, 'QUOTE_NOT_ACCEPTED');
      });

      it('K01 continues on the new quote, with its Udyam certificate sent for review', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const { id, quoteId } = await start('K01');
        await uploadAll(app, owner, id, 'K01');

        const accepted = await owner.post(`/api/v1/quotes/${quoteId}/acceptance`);
        expect(accepted.status).toBe(200);
        expect(accepted.body.status).toBe('ACCEPTED');
        expect(accepted.body.kycApplication).toMatchObject({ id, verdict: 'MANUAL_REVIEW' });

        const read = await owner.get(`${APPLICATIONS}/${id}`);
        expect(read.body.verdict).toBe('MANUAL_REVIEW');
        expect(read.body.quoteChange).toBeNull();
        expect(checkOf(read.body, 'UDYAM_PRESENT')).toMatchObject({ outcome: 'FAIL' });
      });

      it('keeps the raw documents only until rejection', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const { id } = await start('K01');
        await uploadAll(app, owner, id, 'K01');
        expect(storedFiles()).toEqual([]);
      });

      it('leaves a bundle that never needed a GSTIN alone', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const quoteId = await acceptedQuote(owner, noGstinLines);
        const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, contactName: applicant('K01').contactName });
        const { body } = await uploadAll(app, owner, created.body.id, 'K01');
        expect(body.application.verdict).toBe('MANUAL_REVIEW');
        expect(body.application.quoteChange).toBeNull();
        const quote = await owner.get(`/api/v1/quotes/${quoteId}`);
        expect(quote.body.status).toBe('ACCEPTED');
      });
    });

    describe('during a registry outage', () => {
      const outage = (enabled: boolean) =>
        new ApiClient().admin('PUT', '/api/v1/admin/simulations/registry-outage', { enabled });

      it('says verification is pending, keeps progress and lets the owner re-run it', async () => {
        await seedRegistryFor(app, 'K03');
        const { id } = await start('K03');

        await outage(true);
        const { body } = await uploadAll(app, owner, id, 'K03');
        expect(body.application.verdict).toBe('VERIFICATION_PENDING');
        expect(body.application.nextActions).toEqual(['RETRY_VERIFICATION']);
        expect(body.application.retryAfterSeconds).toEqual(expect.any(Number));
        expect(body.application.documents).toHaveLength(4);

        await outage(false);
        const rerun = await owner.post(`${APPLICATIONS}/${id}/reassessment`);
        expect(rerun.status).toBe(200);
        expect(rerun.body.verdict).toBe('VERIFIED');
      });

      it('stays pending while the outage lasts', async () => {
        await seedRegistryFor(app, 'K03');
        const { id } = await start('K03');
        await outage(true);
        await uploadAll(app, owner, id, 'K03');
        const rerun = await owner.post(`${APPLICATIONS}/${id}/reassessment`);
        expect(rerun.body.verdict).toBe('VERIFICATION_PENDING');
      });

      it('does not change the quote on an outage', async () => {
        await seedRegistryFor(app, 'K01', 'Cancelled');
        const { id, quoteId } = await start('K01');
        await outage(true);
        const { body } = await uploadAll(app, owner, id, 'K01');
        expect(body.application.quoteChange).toBeNull();
        expect((await owner.get(`/api/v1/quotes/${quoteId}`)).body.status).toBe('ACCEPTED');
      });

    });

    it('never reveals a registry value, so a mismatch can not be used to learn the right answer', async () => {
      await seedRegistryFor(app, 'K07');
      await app.testDb.client.execute({
        sql: 'UPDATE gst_registry SET trade_name = ?, legal_name = ?, principal_place_of_business = ? WHERE id = ?',
        args: ['Registry Only Clinic', 'Registry Only Legal', 'Registry Only Address', applicant('K07').gstinOnFile],
      });
      const { id } = await start('K07');
      const { body } = await uploadAll(app, owner, id, 'K07');
      expect(JSON.stringify(body.application)).not.toContain('Registry Only');
    });
  });

  describe('withdrawing consent', () => {
    it('stops processing, deletes the documents and fields, and says what it did', async () => {
      const person = applicant('K03');
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      await uploadAll(app, owner, id, 'K03');
      expect(storedFiles().length).toBeGreaterThan(0);

      const response = await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      expect(response.status).toBe(200);
      expect(response.body.effects).toMatchObject({ applicationsStopped: 1, documentsDeleted: 4 });
      expect(storedFiles()).toEqual([]);

      const read = await owner.get(`${APPLICATIONS}/${id}`);
      expect(read.body).toMatchObject({ status: 'ERASED', verdict: null, documents: [], checks: [] });
      expect(read.body.contact).toEqual({ name: null, source: null });
      expect(JSON.stringify(read.body)).not.toContain(person.contactName);

      const rows = await app.testDb.client.execute('SELECT sealed_identity FROM kyc_applications');
      expect(rows.rows[0]?.sealed_identity).toBeNull();
      const fields = await app.testDb.client.execute('SELECT sealed_fields FROM kyc_documents');
      expect(fields.rows.every((row) => row.sealed_fields === null)).toBe(true);

      expectApiError(await owner.post(`${APPLICATIONS}/${id}/reassessment`), 403, 'CONSENT_REQUIRED');
    });

    it('records the erasure in the append-only consent history', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      await uploadAll(app, owner, id, 'K03');
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');

      const rows = await app.testDb.client.execute(
        `SELECT status FROM consents WHERE purpose_id = 'kyc_verification' ORDER BY rowid`,
      );
      expect(rows.rows.map((row) => row.status)).toEqual(['GRANTED', 'WITHDRAWN', 'ERASED']);
    });

    it('can start again after granting consent anew', async () => {
      await seedRegistryFor(app, 'K03');
      const { id, quoteId } = await start('K03');
      await owner.post('/api/v1/consents/kyc_verification/withdrawal');
      await grant(owner, 'kyc_verification');
      const again = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, contactName: applicant('K03').contactName });
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(id);
    });

    it('withdrawing marketing touches nothing else', async () => {
      await seedRegistryFor(app, 'K03');
      const { id } = await start('K03');
      await uploadAll(app, owner, id, 'K03');
      await grant(owner, 'marketing');
      const files = storedFiles();

      const response = await owner.post('/api/v1/consents/marketing/withdrawal');
      expect(response.body.effects).toEqual({
        applicationsStopped: 0,
        documentsDeleted: 0,
        ordersCancelled: 0,
        draftQuotesDeleted: 0,
      });
      expect(storedFiles()).toEqual(files);
      expect((await owner.get(`${APPLICATIONS}/${id}`)).body.verdict).toBe('VERIFIED');
    });

    it('withdrawing advisor consent deletes draft quotes, but keeps an accepted one', async () => {
      const { quoteId } = await start('K03');
      const draft = await owner.post('/api/v1/quotes', { profile: ACTIVE_PROFILE, lines: noGstinLines });
      const response = await owner.post('/api/v1/consents/advisor_profile/withdrawal');
      expect(response.body.effects.draftQuotesDeleted).toBe(1);
      expectApiError(await owner.get(`/api/v1/quotes/${draft.body.id}`), 404, 'NOT_FOUND');
      expect((await owner.get(`/api/v1/quotes/${quoteId}`)).status).toBe(200);
    });
  });

  describe('logging', () => {
    it('never logs a GSTIN, a phone or a name through a whole application', async () => {
      const person = applicant('K10');
      const phone = '9123456780';
      await seedRegistryFor(app, 'K10');
      const quoteId = await acceptedQuote(owner, undefined, undefined, phone);
      const created = await owner.post(APPLICATIONS, { declaredAdultSignatory: true, quoteId, contactName: person.contactName });
      await uploadAll(app, owner, created.body.id, 'K10');
      await owner.post(`${APPLICATIONS}/${created.body.id}/gstin-confirmation`, { gstin: person.gstinOnFile });
      await owner.get(`${APPLICATIONS}/${created.body.id}`);

      expect(app.logs.length).toBeGreaterThan(5);
      const logged = JSON.stringify(app.logs);
      expect(logged).not.toContain(person.gstinOnFile);
      expect(logged).not.toContain(ocrGstin('K10'));
      expect(logged).not.toContain(phone);
      expect(logged).not.toContain(person.contactName);
      expect(logged).not.toContain(person.businessName);
      expect(logged).not.toContain('SYN-ID');
      const audit = JSON.stringify((await app.testDb.client.execute('SELECT * FROM audit_log')).rows);
      expect(audit).not.toContain(person.gstinOnFile);
      expect(audit).not.toContain(person.contactName);
    });

    it('never echoes a phone back in an error or a log', async () => {
      const phone = '9123456780';
      await verifyPhone(owner, phone);
      expect(JSON.stringify(app.logs)).not.toContain(phone);
    });
  });
});
