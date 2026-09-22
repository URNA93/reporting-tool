import { z } from "zod";
import { MANAGED_POSITION_CODES, SELF_REGISTRATION_POSITION_CODES } from "@/lib/positions";

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(80),
  password: z.string().min(10).max(128),
  position: z.enum(SELF_REGISTRATION_POSITION_CODES),
  invitationToken: z.string().uuid().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const unit = z.literal("BU");
const phase = z.enum(["new", "contact", "analysis", "offer", "signature", "processing"]);

const reportItemBase = z.object({
    type: z.enum(["project", "analysis", "consulting", "intro"]),
    personName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    amount: z.number().nonnegative().max(100_000_000).nullable(),
    unit: unit.nullable(),
    dueDate: z.string().date().nullable(),
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    status: z.enum(["active", "completed", "cancelled", "scheduled", "done"]),
    phase: phase.nullable().default(null),
    note: z.string().trim().max(500).default(""),
  });

function validateReportItem(value: z.infer<typeof reportItemBase>, context: z.RefinementCtx) {
    if (value.type === "project" && !["active", "completed", "cancelled"].includes(value.status)) {
      context.addIssue({ code: "custom", message: "Projekt má neplatný stav.", path: ["status"] });
    }
    if (value.type !== "project" && !["scheduled", "done", "cancelled"].includes(value.status)) {
      context.addIssue({ code: "custom", message: "Termín má neplatný stav.", path: ["status"] });
    }
    if (value.type === "project" && value.status === "cancelled" && value.note.length < 3) {
      context.addIssue({ code: "custom", message: "U zrušeného projektu napiš důvod.", path: ["note"] });
    }
    if (value.type === "project" && value.unit !== "BU") {
      context.addIssue({ code: "custom", message: "Objem projektu se zadává vždy v BU.", path: ["unit"] });
    }
    if (value.type === "consulting" && value.unit !== "BU") {
      context.addIssue({ code: "custom", message: "Objem poradenství se zadává vždy v BU.", path: ["unit"] });
    }
    if (value.type === "analysis" && value.unit !== null) {
      context.addIssue({ code: "custom", message: "Analýzy nemají objem v BU.", path: ["unit"] });
    }
    if (value.type === "analysis" && value.amount !== null) {
      context.addIssue({ code: "custom", message: "Analýzy nemají objem v BU.", path: ["amount"] });
    }
    if (value.type === "intro") {
      if (value.unit !== null || value.amount !== null) context.addIssue({ code: "custom", message: "Úvodní rozhovor nemá objem v BU.", path: ["amount"] });
      if (value.description.length > 0) context.addIssue({ code: "custom", message: "Úvodní rozhovor nemá téma.", path: ["description"] });
      if (value.status !== "scheduled") context.addIssue({ code: "custom", message: "Úvodní rozhovor je vždy domluvený.", path: ["status"] });
      if (!value.dueDate || !value.dueTime) context.addIssue({ code: "custom", message: "Vyplň datum i čas úvodního rozhovoru.", path: ["dueDate"] });
    }
}

export const reportItemSchema = reportItemBase.superRefine(validateReportItem);

export const reportSchema = z.object({
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  summary: z.string().trim().max(1000).default(""),
  items: z.array(reportItemSchema).min(1).max(100),
});

export const updateUserSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  position: z.enum(MANAGED_POSITION_CODES),
  role: z.enum(["user", "manager", "admin"]),
  status: z.enum(["active", "disabled"]),
});

export const moveProjectProcessStageSchema = z.object({
  itemId: z.string().uuid(),
  targetStage: z.enum(["project", "analysis", "consulting"]),
});

export const createInvitationSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(80),
  position: z.enum(MANAGED_POSITION_CODES),
  role: z.enum(["user", "manager", "admin"]),
});

export const revokeInvitationSchema = z.object({ invitationId: z.string().uuid() });

export const updateReportItemSchema = reportItemBase
  .extend({ itemId: z.string().uuid() })
  .superRefine(validateReportItem);
export const deleteReportItemSchema = z.object({
  itemId: z.string().uuid(),
  type: z.enum(["project", "fall", "analysis", "consulting", "intro"]),
});
export const updateReportSchema = z.object({ reportId: z.string().uuid(), summary: z.string().trim().max(1000) });
export const deleteReportSchema = z.object({ reportId: z.string().uuid() });
export const resetUserAccessSchema = z.object({ userId: z.string().uuid() });
export const passwordResetRequestSchema = z.object({ email: z.string().email() });
export const passwordUpdateSchema = z.object({ password: z.string().min(10).max(128) });

export const dashboardFilterSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  userId: z.string().uuid().optional(),
  state: z.enum(["active", "completed", "cancelled"]).optional(),
  phase: phase.optional(),
  processStage: z.enum(["project", "analysis", "consulting"]).optional(),
  carryover: z.enum(["yes", "no"]).optional(),
  alert: z.enum(["no_due", "overdue"]).optional(),
});
