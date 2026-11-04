import { eq } from 'drizzle-orm';
import type { GstRecord, UdyamRecord } from '../../../domain/kyc/assess-kyc';
import type { Database } from '../../db/client';
import { gstRegistry, simulationFlags, udyamRegistry } from '../../db/schema';
import type { RegistryBackend } from './mock-registry-client';

/** Reads the seeded registries and returns only the fields the KYC flow needs. */
export function createDbRegistryBackend(db: Database): RegistryBackend {
  return {
    findGstin: async (gstin): Promise<GstRecord | null> => {
      const [row] = await db.select().from(gstRegistry).where(eq(gstRegistry.id, gstin)).limit(1);
      if (!row) return null;
      return {
        gstin: row.id,
        legalName: row.legalName,
        tradeName: row.tradeName,
        address: row.principalPlaceOfBusiness,
        status: row.status as GstRecord['status'],
      };
    },
    findUdyam: async (udyamNumber): Promise<UdyamRecord | null> => {
      const [row] = await db.select().from(udyamRegistry).where(eq(udyamRegistry.id, udyamNumber)).limit(1);
      if (!row) return null;
      return {
        udyamNumber: row.id,
        enterpriseName: row.enterpriseName,
        majorActivity: row.majorActivity,
        city: row.city,
        state: row.state,
        dateOfRegistration: row.dateOfRegistration,
      };
    },
    isOutage: async () => {
      const [row] = await db.select().from(simulationFlags).where(eq(simulationFlags.id, 'REGISTRY_OUTAGE')).limit(1);
      return row?.enabled === 1;
    },
  };
}
