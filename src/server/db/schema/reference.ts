import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestamps } from './columns';
import { enumCheck, REGISTRY_GST_STATUSES } from './enums';

/** The data pack's catalogue. `id` is its product ID, such as P01. */
export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    unit: text('unit').notNull(),
    priceMinInr: integer('price_min_inr').notNull(),
    priceMaxInr: integer('price_max_inr').notNull(),
    setupInr: integer('setup_inr').notNull(),
    minContractMonths: integer('min_contract_months').notNull(),
    // Kept in the CSV's own form, so the domain's parseCatalogue stays the only parser.
    cityTiers: text('city_tiers').notNull(),
    minEmployees: integer('min_employees').notNull(),
    minSites: integer('min_sites').notNull(),
    requiresGstin: integer('requires_gstin').notNull(),
    requiresOneOf: text('requires_one_of').notNull(),
    installDays: integer('install_days').notNull(),
    targetSegments: text('target_segments').notNull(),
    ...timestamps(),
  },
  (table) => [
    check('products_price_range_check', sql`${table.priceMinInr} <= ${table.priceMaxInr}`),
    check('products_requires_gstin_check', sql`${table.requiresGstin} IN (0, 1)`),
  ],
);

/**
 * The data pack's leads. `id` is the lead ID, such as L00001. Only what a server flow reads is
 * copied: the contact prefill and the later back office. Spend, churn and NPS stay in the CSV,
 * where the analytics scripts read them, so this table holds no more personal data than it needs.
 */
export const leads = sqliteTable(
  'leads',
  {
    id: text('id').primaryKey(),
    createdDate: text('created_date').notNull(),
    leadSource: text('lead_source').notNull(),
    businessName: text('business_name').notNull(),
    businessType: text('business_type').notNull(),
    segment: text('segment').notNull(),
    city: text('city').notNull(),
    cityTier: integer('city_tier').notNull(),
    state: text('state').notNull(),
    preferredLanguage: text('preferred_language').notNull(),
    employeeCount: integer('employee_count').notNull(),
    numSites: integer('num_sites').notNull(),
    gstin: text('gstin'),
    udyamNumber: text('udyam_number'),
    contactName: text('contact_name').notNull(),
    contactRole: text('contact_role').notNull(),
    stageReached: text('stage_reached').notNull(),
    outcome: text('outcome').notNull(),
    dropReason: text('drop_reason').notNull(),
    ...timestamps(),
  },
  (table) => [index('leads_gstin_index').on(table.gstin)],
);

/** The mock GST registry. `id` is the GSTIN, which is unique in the data pack. */
export const gstRegistry = sqliteTable(
  'gst_registry',
  {
    id: text('id').primaryKey(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name').notNull(),
    constitution: text('constitution').notNull(),
    principalPlaceOfBusiness: text('principal_place_of_business').notNull(),
    state: text('state').notNull(),
    registrationDate: text('registration_date').notNull(),
    status: text('status').notNull(),
    ...timestamps(),
  },
  (table) => [enumCheck('gst_registry_status_check', table.status, REGISTRY_GST_STATUSES)],
);

/** The mock Udyam registry. `id` is the Udyam number, which is unique in the data pack. */
export const udyamRegistry = sqliteTable('udyam_registry', {
  id: text('id').primaryKey(),
  enterpriseName: text('enterprise_name').notNull(),
  enterpriseType: text('enterprise_type').notNull(),
  majorActivity: text('major_activity').notNull(),
  nicDescription: text('nic_description').notNull(),
  state: text('state').notNull(),
  city: text('city').notNull(),
  dateOfRegistration: text('date_of_registration').notNull(),
  ...timestamps(),
});
