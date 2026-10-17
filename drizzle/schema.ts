import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  code: varchar("code", { length: 14 }).primaryKey(),
  name: text("name"),
  brand: text("brand"),
  quantity: text("quantity"),
  imageUrl: text("image_url"),
  category: text("category"),
  source: varchar("source", { length: 40 }).notNull().default("open_food_facts"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: varchar("source", { length: 40 }).notNull(),
    externalId: varchar("external_id", { length: 160 }).notNull(),
    name: text("name").notNull(),
    city: text("city"),
    countryCode: varchar("country_code", { length: 2 }),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lon: numeric("lon", { precision: 10, scale: 7 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("stores_source_external_id_uq").on(table.source, table.externalId)],
);

export const prices = pgTable(
  "prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: varchar("source", { length: 40 }).notNull(),
    externalId: varchar("external_id", { length: 160 }),
    productCode: varchar("product_code", { length: 14 }).notNull(),
    productName: text("product_name"),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("BRL"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    verification: varchar("verification", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("prices_source_external_id_uq").on(table.source, table.externalId),
    index("prices_product_code_observed_at_idx").on(table.productCode, table.observedAt.desc()),
    check("prices_positive_price_ck", sql`${table.price} > 0`),
  ],
);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: varchar("source", { length: 40 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  records: integer("records").notNull().default(0),
  message: text("message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const anonymousSessions = pgTable("anonymous_sessions", {
  id: uuid("id").primaryKey(),
  legacyCartImported: timestamp("legacy_cart_imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingCartItems = pgTable(
  "shopping_cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => anonymousSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    size: varchar("size", { length: 30 }),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shopping_cart_items_session_position_idx").on(table.sessionId, table.position),
    check("shopping_cart_items_price_ck", sql`${table.price} > 0`),
    check("shopping_cart_items_quantity_ck", sql`${table.quantity} > 0`),
  ],
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => anonymousSessions.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    productName: text("product_name"),
    brand: text("brand"),
    variant: text("variant"),
    size: text("size"),
    unit: varchar("unit", { length: 8 }),
    barcode: varchar("barcode", { length: 14 }),
    price: numeric("price", { precision: 10, scale: 2 }),
    promoPrice: numeric("promo_price", { precision: 10, scale: 2 }),
    memberPrice: numeric("member_price", { precision: 10, scale: 2 }),
    rawText: text("raw_text"),
    priceUncertain: boolean("price_uncertain").notNull().default(false),
    recognized: boolean("recognized").notNull().default(true),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("scans_session_created_at_idx").on(table.sessionId, table.createdAt.desc()),
    check("scans_kind_ck", sql`${table.kind} in ('ticket', 'product')`),
  ],
);
