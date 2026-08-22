import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type CandidateMatchStatus = "new" | "exact" | "domain_match" | "name_match" | "needs_review";
export type CandidateRelevanceStatus = "relevant" | "possible" | "not_relevant" | "needs_review";
export type CandidateRelevanceSource = "system" | "manual";
export type CandidateMonitoringStatus = "monitoring" | "not_monitoring";

export type CandidateSnapshotData = {
  employees?: number | null;
  revenue?: string | null;
  owner?: string | null;
  personName?: string | null;
  roleTitle?: string | null;
  profileUrl?: string | null;
  fields: Record<string, string>;
};

export const leadCandidatesTable = pgTable(
  "lead_candidates",
  {
    id: serial("id").primaryKey(),
    companyName: text("company_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    organizationNumber: text("organization_number"),
    domain: text("domain"),
    industry: text("industry"),
    employees: integer("employees"),
    matchStatus: text("match_status").notNull().default("new").$type<CandidateMatchStatus>(),
    relevanceStatus: text("relevance_status").notNull().default("needs_review").$type<CandidateRelevanceStatus>(),
    relevanceReason: text("relevance_reason"),
    relevanceSource: text("relevance_source").notNull().default("system").$type<CandidateRelevanceSource>(),
    monitoringStatus: text("monitoring_status").notNull().default("not_monitoring").$type<CandidateMonitoringStatus>(),
    monitoringReason: text("monitoring_reason"),
    priorityScore: integer("priority_score").notNull().default(0),
    priorityReasons: jsonb("priority_reasons").$type<string[]>().notNull().default([]),
    lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    normalizedNameIdx: index("lead_candidates_normalized_name_idx").on(table.normalizedName),
    organizationNumberIdx: index("lead_candidates_organization_number_idx").on(table.organizationNumber),
    domainIdx: index("lead_candidates_domain_idx").on(table.domain),
    relevanceStatusIdx: index("lead_candidates_relevance_status_idx").on(table.relevanceStatus),
    monitoringStatusIdx: index("lead_candidates_monitoring_status_idx").on(table.monitoringStatus),
  }),
);

export const leadCandidateSnapshotsTable = pgTable(
  "lead_candidate_snapshots",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => leadCandidatesTable.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceRowId: text("source_row_id"),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    originalCompanyName: text("original_company_name").notNull(),
    data: jsonb("data").$type<CandidateSnapshotData>().notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    candidateSnapshotIdx: index("lead_candidate_snapshots_candidate_idx").on(table.candidateId, table.snapshotDate),
    sourceSnapshotIdx: index("lead_candidate_snapshots_source_idx").on(table.sourceType, table.snapshotDate),
  }),
);

export const leadCandidateEvidenceTable = pgTable(
  "lead_candidate_evidence",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => leadCandidatesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    sourceType: text("source_type").notNull(),
    publishedAt: date("published_at", { mode: "string" }).notNull(),
    excerpt: text("excerpt").notNull(),
    verificationStatus: text("verification_status").notNull().default("url_verified"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    candidateEvidenceIdx: index("lead_candidate_evidence_candidate_idx").on(table.candidateId),
  }),
);

export const leadAnalysisBatchesTable = pgTable("lead_analysis_batches", {
  id: serial("id").primaryKey(),
  requestedCount: integer("requested_count").notNull(),
  selectedCandidateIds: jsonb("selected_candidate_ids").$type<number[]>().notNull(),
  criteria: text("criteria").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});