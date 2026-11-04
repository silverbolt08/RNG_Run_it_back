import { and, eq, inArray, ne } from 'drizzle-orm';
import type { AppContext } from '../app-context';
import type { SessionInfo } from '../auth/session-service';
import { appendErased, appendWithdrawal, type ConsentState } from '../consent/consent-service';
import { conversations, kycApplications, orderEvents, orders, quotes } from '../db/schema';
import type { ConsentPurpose } from '../db/schema/enums';
import { newPublicId } from '../../lib/ids';
import { recordAudit } from '../db/repositories/audit-repository';
import { deleteRawFiles, eraseApplication } from './kyc/kyc-erasure';

export type WithdrawalEffects = {
  applicationsStopped: number;
  documentsDeleted: number;
  ordersCancelled: number;
  draftQuotesDeleted: number;
};

export type WithdrawalResult = ConsentState & { effects: WithdrawalEffects };

const NO_EFFECTS: WithdrawalEffects = {
  applicationsStopped: 0,
  documentsDeleted: 0,
  ordersCancelled: 0,
  draftQuotesDeleted: 0,
};

/** Withdrawal is as easy as granting. What it stops depends on the purpose, and marketing stops nothing else. */
export async function withdrawConsent(
  app: AppContext,
  session: SessionInfo,
  purpose: ConsentPurpose,
  requestId: string,
): Promise<WithdrawalResult> {
  const state = await appendWithdrawal(app, session.subjectRef, purpose, requestId);

  if (purpose === 'kyc_verification') {
    const { effects, fieldsRetained } = await stopKyc(app, session, requestId);
    // The retention job records the erasure later, once the contract term has ended.
    if (!fieldsRetained) await appendErased(app, session.subjectRef, purpose);
    return { ...state, effects };
  }
  if (purpose === 'advisor_profile') {
    return { ...state, effects: { ...NO_EFFECTS, draftQuotesDeleted: await deleteAdvisorData(app, session.ownerId) } };
  }
  return { ...state, effects: NO_EFFECTS };
}

/**
 * Stops processing and erases, unless an activated order rests on the application. Then the raw
 * documents go, but the extracted fields stay for the contract term, as the retention policy says.
 */
async function stopKyc(
  app: AppContext,
  session: SessionInfo,
  requestId: string,
): Promise<{ effects: WithdrawalEffects; fieldsRetained: boolean }> {
  const applications = await app.db
    .select()
    .from(kycApplications)
    .where(and(eq(kycApplications.ownerId, session.ownerId), ne(kycApplications.status, 'ERASED')));

  let documentsDeleted = 0;
  let ordersCancelled = 0;
  let fieldsRetained = false;

  for (const application of applications) {
    const linked = await app.db
      .select()
      .from(orders)
      .where(and(eq(orders.kycApplicationId, application.id), ne(orders.status, 'CANCELLED')));
    const activated = linked.some((order) => order.stage === 'ACTIVATED');

    if (activated) {
      fieldsRetained = true;
      documentsDeleted += await deleteRawFiles(app, application.id);
      await app.db
        .update(kycApplications)
        .set({ status: 'WITHDRAWN', updatedAt: app.clock.now().toISOString() })
        .where(eq(kycApplications.id, application.id));
      continue;
    }

    for (const order of linked) {
      await cancelOrder(app, order.id, requestId);
      ordersCancelled += 1;
    }
    documentsDeleted += await eraseApplication(app, application);
  }

  await recordAudit(app, {
    actorRef: session.subjectRef,
    action: 'KYC_WITHDRAWAL_APPLIED',
    objectType: 'owner',
    objectId: session.subjectRef,
    requestId,
    metadata: { applications: applications.length, documentsDeleted, ordersCancelled },
  });
  return {
    effects: { ...NO_EFFECTS, applicationsStopped: applications.length, documentsDeleted, ordersCancelled },
    fieldsRetained,
  };
}

async function cancelOrder(app: AppContext, orderId: string, requestId: string): Promise<void> {
  const now = app.clock.now().toISOString();
  await app.db.update(orders).set({ status: 'CANCELLED', updatedAt: now }).where(eq(orders.id, orderId));
  await app.db.insert(orderEvents).values({
    id: newPublicId('evt'),
    orderId,
    type: 'ORDER_CANCELLED',
    reasonCode: 'KYC_CONSENT_WITHDRAWN',
    occurredOn: app.clock.today(),
    simulated: 0,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit(app, {
    actorRef: 'system',
    action: 'ORDER_CANCELLED',
    objectType: 'order',
    objectId: orderId,
    requestId,
    metadata: { reason: 'KYC_CONSENT_WITHDRAWN' },
  });
}

/** Business details held only for the recommendation. An accepted quote now belongs to the order. */
async function deleteAdvisorData(app: AppContext, ownerId: string): Promise<number> {
  await app.db.delete(conversations).where(eq(conversations.ownerId, ownerId));
  const deleted = await app.db
    .delete(quotes)
    .where(and(eq(quotes.ownerId, ownerId), inArray(quotes.status, ['DRAFT', 'SAVED'])))
    .returning({ id: quotes.id });
  return deleted.length;
}
