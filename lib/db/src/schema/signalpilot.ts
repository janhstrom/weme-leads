import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type SignalEvidence = {
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string;
  excerpt: string;
  verificationStatus: "url_verified";
  verifiedAt: string;
};

export type SignalContact = {
  id: number;
  crmContactId?: number | null;
  name: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  confidence: "bekreftet" | "fra_crm" | "fra_sales_navigator" | "ikke_verifisert";
  rationale: string;
};

export type SignalCrm = {
  status: string;
  matchCount: number;
  note?: string | null;
  writeStatus?: "not_started" | "pending" | "completed" | "partial" | "failed";
  crmContactId?: number | null;
  noteCreatedAt?: string | Date | null;
  taskCreatedAt?: string | Date | null;
  taskId?: number | null;
};

export const signalpilotSignalsTable = pgTable("signalpilot_signals", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  employees: integer("employees").notNull(),
  industry: text("industry").notNull(),
  domain: text("domain").notNull(),
  signalType: text("signal_type").notNull(),
  strength: text("strength").notNull(),
  status: text("status").notNull().default("til_vurdering"),
  summary: text("summary").notNull(),
  rationale: text("rationale").notNull(),
  publishedAt: date("published_at", { mode: "string" }).notNull(),
  evidence: jsonb("evidence").$type<SignalEvidence[]>().notNull(),
  contacts: jsonb("contacts").$type<SignalContact[]>().notNull(),
  crm: jsonb("crm").$type<SignalCrm>().notNull(),
  suggestedOpening: text("suggested_opening").notNull(),
  dialogueDraft: text("dialogue_draft").notNull(),
  reviewReason: text("review_reason"),
  reviewComment: text("review_comment"),
  crmTaskCreated: boolean("crm_task_created").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSignalpilotSignalSchema = createInsertSchema(signalpilotSignalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSignalpilotSignal = z.infer<typeof insertSignalpilotSignalSchema>;
export type SignalpilotSignal = typeof signalpilotSignalsTable.$inferSelect;