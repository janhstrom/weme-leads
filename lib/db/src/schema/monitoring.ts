import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { leadCandidatesTable } from "./candidates";

export type MonitoringRunStatus = "running" | "completed" | "completed_with_errors" | "failed";
export type MonitoringRunTrigger = "manual" | "scheduled";
export type MonitoringItemStatus = "processed" | "skipped" | "failed";
export type CandidateSourceType = "rss" | "atom";

export const leadCandidateSourcesTable = pgTable(
  "lead_candidate_sources",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => leadCandidatesTable.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull().$type<CandidateSourceType>(),
    url: text("url").notNull(),
    label: text("label").notNull(),
    isActive: text("is_active").notNull().default("true"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    candidateIdx: index("lead_candidate_sources_candidate_idx").on(table.candidateId),
    candidateUrlUnique: uniqueIndex("lead_candidate_sources_candidate_url_unique").on(table.candidateId, table.url),
  }),
);

export const leadMonitoringRunsTable = pgTable(
  "lead_monitoring_runs",
  {
    id: serial("id").primaryKey(),
    status: text("status").notNull().$type<MonitoringRunStatus>(),
    trigger: text("trigger").notNull().$type<MonitoringRunTrigger>(),
    requestedCount: integer("requested_count").notNull(),
    processedCount: integer("processed_count").notNull().default(0),
    signalsCreated: integer("signals_created").notNull().default(0),
    crmMatchedCount: integer("crm_matched_count").notNull().default(0),
    crmUnresolvedCount: integer("crm_unresolved_count").notNull().default(0),
    sourceErrorCount: integer("source_error_count").notNull().default(0),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index("lead_monitoring_runs_status_idx").on(table.status, table.startedAt),
  }),
);

export const leadMonitoringRunItemsTable = pgTable(
  "lead_monitoring_run_items",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => leadMonitoringRunsTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => leadCandidatesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().$type<MonitoringItemStatus>(),
    brregStatus: text("brreg_status").notNull(),
    crmStatus: text("crm_status").notNull(),
    signalsCreated: integer("signals_created").notNull().default(0),
    sourceErrorCount: integer("source_error_count").notNull().default(0),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("lead_monitoring_run_items_run_idx").on(table.runId),
    candidateIdx: index("lead_monitoring_run_items_candidate_idx").on(table.candidateId, table.createdAt),
  }),
);