import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { POSITION_CODES } from "@/lib/positions";

const nowMs = sql`(unixepoch() * 1000)`;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    position: text("position", { enum: POSITION_CODES }).notNull().default("T"),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    role: text("role", { enum: ["admin", "manager", "reporter", "viewer"] })
      .notNull()
      .default("reporter"),
    status: text("status", { enum: ["invited", "active", "disabled"] })
      .notNull()
      .default("invited"),
    canViewAll: integer("can_view_all", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status", { enum: ["draft", "submitted"] })
      .notNull()
      .default("submitted"),
    syncStatus: text("sync_status", { enum: ["pending", "synced", "failed"] })
      .notNull()
      .default("pending"),
    syncError: text("sync_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    index("reports_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("reports_sync_status_idx").on(table.syncStatus),
  ],
);

export const reportItems = sqliteTable(
  "report_items",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["project", "fall", "analysis", "consulting", "intro"] })
      .notNull(),
    personName: text("person_name").notNull(),
    description: text("description").notNull().default(""),
    amount: real("amount"),
    unit: text("unit", { enum: ["ks", "BU", "Kč", "%"] }),
    dueDate: text("due_date"),
    dueTime: text("due_time"),
    status: text("status", {
      enum: ["new", "in_progress", "scheduled", "done", "cancelled"],
    })
      .notNull()
      .default("new"),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    index("report_items_report_id_idx").on(table.reportId),
    index("report_items_type_due_date_idx").on(table.type, table.dueDate),
  ],
);

export const accessGrants = sqliteTable(
  "access_grants",
  {
    viewerUserId: text("viewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectUserId: text("subject_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    primaryKey({ columns: [table.viewerUserId, table.subjectUserId] }),
    index("access_grants_subject_idx").on(table.subjectUserId),
  ],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    ip: text("ip").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    index("login_attempts_email_ip_idx").on(
      table.email,
      table.ip,
      table.createdAt,
    ),
  ],
);

export const passwordResetUses = sqliteTable("password_reset_uses", {
  tokenId: text("token_id").primaryKey(),
  usedByEmail: text("used_by_email").notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

export const usersRelations = relations(users, ({ many }) => ({
  reports: many(reports),
  sessions: many(sessions),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  user: one(users, { fields: [reports.userId], references: [users.id] }),
  items: many(reportItems),
}));

export const reportItemsRelations = relations(reportItems, ({ one }) => ({
  report: one(reports, {
    fields: [reportItems.reportId],
    references: [reports.id],
  }),
}));
