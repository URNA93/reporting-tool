import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Supabase migration protects every reporting table with RLS", async () => {
  const sql = await readFile(new URL("supabase/migrations/202609040001_reporting_core.sql", root), "utf8");
  for (const table of ["profiles", "reports", "projects", "appointments", "invitations"]) {
    assert.match(sql, new RegExp(`alter table public\\.reporting_${table} enable row level security`));
  }
  assert.match(sql, /reporting_admin_update_profile/);
  assert.match(sql, /p_user_id = auth\.uid\(\)/);
  assert.match(sql, /reporting_delete_report/);
  assert.match(sql, /target_owner <> auth\.uid\(\)/);
});

test("registration has an exact company-domain gate and no client role input", async () => {
  const route = await readFile(new URL("app/api/auth/register/route.ts", root), "utf8");
  const form = await readFile(new URL("components/AuthForm.tsx", root), "utf8");
  assert.match(route, /isCompanyEmail/);
  assert.match(route, /app_source: "gfs_reporting"/);
  assert.doesNotMatch(form, /name="role"/);
  assert.doesNotMatch(form, /setupCode/);
});

test("manual falls are absent and carryover insertion is idempotent", async () => {
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");
  const sql = await readFile(new URL("supabase/migrations/202609040001_reporting_core.sql", root), "utf8");
  assert.match(dashboard, /\["project", "analysis", "consulting", "intro"\]/);
  assert.match(sql, /reporting_projects_carryover_once/);
  assert.match(sql, /on conflict \(previous_project_id, period_start, period_end\)/);
});

test("project process stages are server-enforced and survive carryovers", async () => {
  const migration = await readFile(new URL("supabase/migrations/202609100001_project_process_stages_and_profile_name.sql", root), "utf8");
  const route = await readFile(new URL("app/api/report-items/process-stage/route.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");

  assert.match(migration, /process_stage public\.reporting_process_stage/);
  assert.match(migration, /p\.process_stage/);
  assert.match(migration, /previous_project_id, period_start, period_end/);
  assert.match(migration, /project_row\.state <> 'active'/);
  assert.match(migration, /project_row\.owner_id <> auth\.uid\(\) and not public\.reporting_is_manager\(\)/);
  assert.match(migration, /Projekt lze posunout jen o jeden procesní krok/);
  assert.match(migration, /moved_to_analysis_at/);
  assert.match(migration, /moved_to_consulting_at/);
  assert.match(route, /getSessionUser/);
  assert.match(route, /hasValidOrigin/);
  assert.match(route, /reporting_move_project_process_stage/);
  assert.match(dashboard, /Přesunout do analýzy/);
  assert.match(dashboard, /Přesunout do poradenství/);
  assert.match(dashboard, /user\.role === "admin"/);
  assert.match(dashboard, /Procesní fáze projektu/);
  assert.match(dashboard, /<Dialog open=\{Boolean\(editDraft\)\}/);
});

test("future-dated projects wait for their due period before becoming a carryover", async () => {
  const migration = await readFile(new URL("supabase/migrations/202609120003_defer_future_due_carryovers.sql", root), "utf8");
  const data = await readFile(new URL("lib/data.ts", root), "utf8");

  assert.match(migration, /p\.due_date is null or p\.due_date <= previous_end/);
  assert.match(migration, /not exists \(/);
  assert.match(migration, /next_project\.previous_project_id = p\.id/);
  assert.match(data, /item\.due_date && !item\.is_carryover/);
  assert.match(data, /carriedProjectIds/);
});

test("dashboard uses one filtered source for date ranges and paginates only the rendered item list", async () => {
  const data = await readFile(new URL("lib/data.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");
  const route = await readFile(new URL("app/api/dashboard/route.ts", root), "utf8");

  assert.match(route, /periodStart/);
  assert.match(data, /projectsQuery = projectsQuery\.gte\("due_date", filters\.from\)/);
  assert.match(data, /appointmentsQuery = appointmentsQuery\.lte\("due_date", filters\.to\)/);
  assert.match(data, /const projectVolumes = projects\.reduce/);
  assert.match(dashboard, /const ITEMS_PER_PAGE = 20/);
  assert.match(dashboard, /paginatedItems\.map/);
  assert.match(dashboard, /Strana \{currentItemsPage\} z \{itemsPageCount\}/);
  assert.match(dashboard, /activateNoDueFilter/);
});

test("only the admin profile RPC can change a displayed user name", async () => {
  const validation = await readFile(new URL("lib/validation.ts", root), "utf8");
  const route = await readFile(new URL("app/api/admin/users/route.ts", root), "utf8");
  const panel = await readFile(new URL("components/AdminPanel.tsx", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609100001_project_process_stages_and_profile_name.sql", root), "utf8");

  assert.match(validation, /name: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(80\)/);
  assert.match(route, /p_name: parsed\.data\.name/);
  assert.match(panel, /Jméno a příjmení/);
  assert.match(migration, /if not public\.reporting_is_admin\(\)/);
  assert.match(migration, /set name = left\(trim\(p_name\), 80\)/);
  assert.doesNotMatch(migration, /set email =/);
});

test("admin invitations are token-bound and cannot grant roles from the public form", async () => {
  const sql = await readFile(new URL("supabase/migrations/202609040002_admin_invitations.sql", root), "utf8");
  const route = await readFile(new URL("app/api/auth/register/route.ts", root), "utf8");
  const form = await readFile(new URL("components/AuthForm.tsx", root), "utf8");

  assert.match(sql, /reporting_admin_create_invitation/);
  assert.match(sql, /reporting_is_admin\(\)/);
  assert.match(sql, /invite_token = token_text::uuid/);
  assert.match(sql, /lower\(email\) = lower\(new\.email\)/);
  assert.match(sql, /accepted_at = now\(\)/);
  assert.match(route, /reporting_get_invitation/);
  assert.match(route, /invitation_token: parsed\.data\.invitationToken/);
  assert.doesNotMatch(form, /name="role"/);
});

test("manual admin invitations send a password-setup link and block reporting until it is completed", async () => {
  const adminUsers = await readFile(new URL("app/api/admin/users/route.ts", root), "utf8");
  const auth = await readFile(new URL("lib/auth.ts", root), "utf8");
  const login = await readFile(new URL("app/api/auth/login/route.ts", root), "utf8");
  const callback = await readFile(new URL("app/auth/callback/route.ts", root), "utf8");
  const updatePassword = await readFile(new URL("app/api/auth/update-password/route.ts", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609080002_manual_invite_password_setup.sql", root), "utf8");

  assert.match(adminUsers, /createSupabaseStatelessClient/);
  assert.match(adminUsers, /auth\.auth\.signUp/);
  assert.match(adminUsers, /emailRedirectTo: `\$\{origin\}\/auth\/callback\?next=\/nastavit-heslo`/);
  assert.match(adminUsers, /invitation_token: invitation\.invite_token/);
  assert.doesNotMatch(adminUsers, /temporaryPassword.*Response\.json/);
  assert.match(auth, /requiresPasswordSetup/);
  assert.match(auth, /profile\.requires_password_setup && !options\.allowPasswordSetup/);
  assert.match(login, /requiresPasswordSetup: Boolean\(profile\?\.requires_password_setup\)/);
  assert.match(callback, /profile\?\.requires_password_setup/);
  assert.match(updatePassword, /reporting_complete_password_setup/);
  assert.match(migration, /add column if not exists requires_password_setup boolean/);
  assert.match(migration, /requires_password_setup\)\n  values .*invitation\.id is not null/s);
  assert.match(migration, /reporting_complete_password_setup/);
  assert.match(migration, /reporting_admin_start_password_setup/);
});

test("project volume is always stored as BU", async () => {
  const validation = await readFile(new URL("lib/validation.ts", root), "utf8");
  const route = await readFile(new URL("app/api/report-items/route.ts", root), "utf8");
  const form = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");
  const sql = await readFile(new URL("supabase/migrations/202609050001_project_unit_bu.sql", root), "utf8");

  assert.match(validation, /z\.literal\("BU"\)/);
  assert.doesNotMatch(route, /unit: parsed\.data\.unit/);
  assert.match(form, /<Input value="BU" readOnly/);
  assert.doesNotMatch(form, /\["ks", "BU", "Kč", "%"\]/);
  assert.match(sql, /check \(unit = 'BU'\)/);
  assert.match(sql, /revoke update \(unit\)/);
  assert.match(sql, /nullif\(item ->> 'amount', ''\)::numeric, 'BU'/);
});

test("new report form does not include a short summary field", async () => {
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");

  assert.doesNotMatch(dashboard, /Krátký souhrn/);
  assert.match(dashboard, /summary: ""/);
});

test("introductory conversations are accepted by report creation and deletion", async () => {
  const validation = await readFile(new URL("lib/validation.ts", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609220003_enable_introductory_conversations.sql", root), "utf8");

  assert.match(validation, /\["project", "analysis", "consulting", "intro"\]/);
  assert.match(migration, /add value if not exists 'intro'/);
  assert.match(migration, /item_type in \('analysis','consulting','intro'\)/);
  assert.match(migration, /p_item_type in \('analysis', 'consulting', 'intro'\)/);
  assert.match(migration, /Úvodní rozhovor musí mít datum a čas/);
});

test("report editing opens the report's stored items instead of the summary editor", async () => {
  const data = await readFile(new URL("lib/data.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");

  assert.match(data, /reportId: project\.source_report_id/);
  assert.match(data, /reportId: item\.report_id/);
  assert.match(dashboard, /function openReportItems/);
  assert.match(dashboard, /item\.reportId === report\.id/);
  assert.match(dashboard, /Položky reportu/);
  assert.doesNotMatch(dashboard, /Upravit souhrn reportu/);
});

test("consulting uses the same BU volume and deletions are mirrored to Google Sheets", async () => {
  const validation = await readFile(new URL("lib/validation.ts", root), "utf8");
  const route = await readFile(new URL("app/api/report-items/route.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609080003_unify_bu_volume.sql", root), "utf8");
  const sheetBridge = await readFile(new URL("integrations/google-sheets/Code.gs", root), "utf8");
  const itemRoute = await readFile(new URL("app/api/report-items/route.ts", root), "utf8");
  const reportRoute = await readFile(new URL("app/api/reports/route.ts", root), "utf8");

  assert.match(validation, /Objem poradenství se zadává vždy v BU/);
  assert.match(dashboard, /Objem poradenství/);
  assert.match(dashboard, /Objem v BU/);
  assert.match(route, /value_bu: parsed\.data\.type === "consulting" \? parsed\.data\.amount : null/);
  assert.match(dashboard, /formatItemValue/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /reporting_delete_item/);
  assert.match(migration, /add column if not exists value_bu numeric\(16,2\)/);
  assert.match(migration, /set value_bu = points/);
  assert.match(migration, /item ->> 'amount'/);
  assert.match(sheetBridge, /delete_item/);
  assert.match(sheetBridge, /delete_report/);
  assert.match(sheetBridge, /function deleteByKey_/);
  assert.match(sheetBridge, /sheet\.deleteRow/);
  assert.match(itemRoute, /syncSheetDeletion\(supabase, "item", parsed\.data\.itemId\)/);
  assert.match(reportRoute, /syncSheetDeletion\(supabase, "report", parsed\.data\.reportId\)/);
});

test("analysis-to-consulting uses the edited form and preserves one appointment record", async () => {
  const route = await readFile(new URL("app/api/report-items/route.ts", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609140001_safe_process_transitions.sql", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");

  assert.match(route, /reporting_convert_analysis_to_consulting/);
  assert.match(migration, /update public\.reporting_appointments/);
  assert.match(migration, /set type = 'consulting'/);
  assert.match(dashboard, /function prepareAnalysisForConsulting/);
  assert.match(dashboard, /Přesun potvrdíš až uložením změn/);
  assert.match(dashboard, /Přesunout do poradenství/);
});

test("process filtering and admin corrections use the same secured model", async () => {
  const data = await readFile(new URL("lib/data.ts", root), "utf8");
  const route = await readFile(new URL("app/api/dashboard/route.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609140001_safe_process_transitions.sql", root), "utf8");

  assert.match(route, /processStage/);
  assert.match(data, /projectsQuery = projectsQuery\.eq\("process_stage", filters\.processStage\)/);
  assert.match(data, /appointmentsQuery = appointmentsQuery\.eq\("type", "analysis"\)/);
  assert.match(data, /appointmentsQuery = appointmentsQuery\.eq\("type", "intro"\)/);
  assert.match(dashboard, /Proces/);
  assert.match(dashboard, /user\.role === "admin"/);
  assert.match(migration, /not public\.reporting_is_admin\(\) and not \(/);
  assert.match(migration, /reporting_convert_consulting_to_analysis/);
});

test("appointment edits use a protected RPC instead of a direct table update", async () => {
  const route = await readFile(new URL("app/api/report-items/route.ts", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609140002_allow_owner_appointment_updates.sql", root), "utf8");

  assert.match(route, /rpc\("reporting_update_appointment"/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set row_security = off/);
  assert.match(migration, /row\.owner_id <> auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.reporting_update_appointment/);
});

test("consulting project time and manager reassignment are persisted by protected RPCs", async () => {
  const route = await readFile(new URL("app/api/report-items/route.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");
  const data = await readFile(new URL("lib/data.ts", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609220002_project_time_and_manager_reassignment.sql", root), "utf8");

  assert.match(route, /p_due_time: parsed\.data\.dueTime/);
  assert.match(route, /p_owner_id: parsed\.data\.ownerId/);
  assert.match(dashboard, /projectConsulting/);
  assert.match(dashboard, /Řešitel/);
  assert.match(data, /due_time/);
  assert.match(migration, /add column if not exists due_time time/);
  assert.match(migration, /p\.due_time/);
  assert.match(migration, /if not public\.reporting_is_manager\(\) then raise exception 'Řešitele může změnit jen manažer'/);
  assert.match(migration, /reporting_assert_assignable_owner/);
  assert.match(migration, /not public\.reporting_is_master_email\(profile\.email\)/);
  assert.match(migration, /security definer/);
});

test("hidden master account is the only non-company login and is excluded from people APIs", async () => {
  const auth = await readFile(new URL("lib/auth.ts", root), "utf8");
  const dashboardData = await readFile(new URL("lib/data.ts", root), "utf8");
  const adminUsers = await readFile(new URL("app/api/admin/users/route.ts", root), "utf8");
  const registration = await readFile(new URL("app/api/auth/register/route.ts", root), "utf8");
  const migration = await readFile(new URL("supabase/migrations/202609060001_hidden_master_account.sql", root), "utf8");

  assert.match(auth, /REPORTING_MASTER_ADMIN_EMAIL/);
  assert.match(auth, /REPORTING_COMPANY_DOMAIN/);
  assert.doesNotMatch(auth, /urna93@gmail\.com/);
  assert.match(auth, /isAllowedLoginEmail/);
  assert.match(registration, /isCompanyEmail/);
  assert.doesNotMatch(registration, /isAllowedLoginEmail/);
  assert.match(dashboardData, /normalizeEmail\(profile\.email\) !== MASTER_ADMIN_EMAIL/);
  assert.match(adminUsers, /normalizeEmail\(user\.email\) !== MASTER_ADMIN_EMAIL/);
  assert.match(migration, /reporting_is_master_email/);
  assert.match(migration, /reporting_system_config/);
  assert.doesNotMatch(migration, /urna93@gmail\.com/);
  assert.match(migration, /user_role := 'user'/);
  assert.doesNotMatch(migration, /patrik\.kobaj@gfsgroup\.cz/);
});

test("a newly saved report returns a fresh private dashboard to its owner", async () => {
  const dashboardRoute = await readFile(new URL("app/api/dashboard/route.ts", root), "utf8");
  const reportsRoute = await readFile(new URL("app/api/reports/route.ts", root), "utf8");
  const dashboard = await readFile(new URL("components/DashboardApp.tsx", root), "utf8");

  assert.match(dashboardRoute, /private, no-store, max-age=0/);
  assert.match(reportsRoute, /const dashboard = await getDashboardData\(user\)/);
  assert.match(reportsRoute, /dashboard,/);
  assert.match(dashboard, /cache: "no-store"/);
  assert.match(dashboard, /setData\(result\.dashboard\)/);
  assert.match(dashboard, /useEffect\(\(\) =>/);
  assert.match(dashboard, /fetch\("\/api\/dashboard"/);
});
