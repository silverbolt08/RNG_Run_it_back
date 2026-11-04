import { asc, eq } from 'drizzle-orm';
import { newPublicId } from '../../../lib/ids';
import type { Clock } from '../../../lib/clock';
import type { Database } from '../../db/client';
import { notifications } from '../../db/schema';

export type StatusMessage = {
  ownerId: string;
  orderId: string;
  /** A message catalogue key, so each language can word it. */
  templateCode: string;
  /** Order facts such as a stage or date. Never personal data. */
  params: Record<string, string>;
};

export type LoggedMessage = { templateCode: string; params: Record<string, string>; loggedAt: string };

/**
 * A mock of an SMS or WhatsApp sender: nothing leaves the app. Callers must check for
 * `service_updates` consent first, which order-service does in one place.
 */
export interface NotificationLog {
  record(message: StatusMessage): Promise<void>;
  listForOrder(orderId: string): Promise<LoggedMessage[]>;
}

export function createDbNotificationLog(db: Database, clock: Clock): NotificationLog {
  return {
    record: async (message) => {
      const now = clock.now().toISOString();
      await db.insert(notifications).values({
        id: newPublicId('ntf'),
        ownerId: message.ownerId,
        orderId: message.orderId,
        templateCode: message.templateCode,
        params: JSON.stringify(message.params),
        createdAt: now,
        updatedAt: now,
      });
    },
    listForOrder: async (orderId) => {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.orderId, orderId))
        .orderBy(asc(notifications.createdAt));
      return rows.map((row) => ({
        templateCode: row.templateCode,
        params: JSON.parse(row.params) as Record<string, string>,
        loggedAt: row.createdAt,
      }));
    },
  };
}
