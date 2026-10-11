import { MASTER_ADMIN_EMAIL, normalizeEmail, type SessionUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Filters = {
  from?: string | null;
  to?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  userId?: string | null;
  state?: "active" | "completed" | "cancelled" | null;
  phase?: "new" | "contact" | "analysis" | "offer" | "signature" | "processing" | null;
  processStage?: "project" | "analysis" | "consulting" | "intro" | null;
  carryover?: "yes" | "no" | null;
  alert?: "no_due" | "overdue" | null;
};

export async function getDashboardData(user: SessionUser, filters: Filters = {}) {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("reporting_sync_current_carryovers");

  const { data: profileRows = [] } = await supabase
    .from("reporting_profiles")
    .select("id,name,email,position,role,status")
    .eq("status", "active")
    .order("name");
  const masterProfile = (profileRows ?? []).find((profile) => normalizeEmail(profile.email) === MASTER_ADMIN_EMAIL);
  const profiles = (profileRows ?? []).filter((profile) => normalizeEmail(profile.email) !== MASTER_ADMIN_EMAIL);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  // RLS hides the master from ordinary users. Two missing IDs are not a master selection.
  const requestedUserId = masterProfile && masterProfile.id === filters.userId
    ? "00000000-0000-0000-0000-000000000000"
    : user.canManageReports && filters.userId
      ? filters.userId
      : user.canManageReports
        ? null
        : user.id;

  let reportsQuery = supabase
    .from("reporting_reports")
    .select("id,user_id,period_start,period_end,summary,sync_status,created_at,updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(250);
  let projectsQuery = supabase
    .from("reporting_projects")
    .select("id,owner_id,source_report_id,period_start,period_end,previous_project_id,name,description,value,unit,state,phase,process_stage,moved_to_analysis_at,moved_to_consulting_at,due_date,due_time,is_carryover,cancellation_reason,created_at,updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  let appointmentsQuery = supabase
    .from("reporting_appointments")
    .select("id,owner_id,report_id,period_start,period_end,type,client_name,description,value_bu,due_date,due_time,status,note,created_at,updated_at")
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(500);

  if (masterProfile) {
    reportsQuery = reportsQuery.neq("user_id", masterProfile.id);
    projectsQuery = projectsQuery.neq("owner_id", masterProfile.id);
    appointmentsQuery = appointmentsQuery.neq("owner_id", masterProfile.id);
  }

  if (requestedUserId) {
    reportsQuery = reportsQuery.eq("user_id", requestedUserId);
    projectsQuery = projectsQuery.eq("owner_id", requestedUserId);
    appointmentsQuery = appointmentsQuery.eq("owner_id", requestedUserId);
  }
  // Pro uložené reporty zůstává období jejich účetním obdobím. Doložené
  // projekty a termíny ale v přehledu patří do období svého data; bez data
  // se použije jejich uložené reportovací období. Položky proto vyfiltrujeme
  // až po načtení (SQL by jinak vyřadilo věc naplánovanou do dalšího období).
  if (filters.periodStart) {
    reportsQuery = reportsQuery.gte("period_end", filters.periodStart);
  }
  if (filters.periodEnd) {
    reportsQuery = reportsQuery.lte("period_start", filters.periodEnd);
  }
  if (filters.from) {
    projectsQuery = projectsQuery.gte("due_date", filters.from);
    appointmentsQuery = appointmentsQuery.gte("due_date", filters.from);
  }
  if (filters.to) {
    projectsQuery = projectsQuery.lte("due_date", filters.to);
    appointmentsQuery = appointmentsQuery.lte("due_date", filters.to);
  }
  if (filters.state) {
    projectsQuery = projectsQuery.eq("state", filters.state);
    appointmentsQuery = appointmentsQuery.eq("status", filters.state === "active" ? "scheduled" : filters.state === "completed" ? "done" : "cancelled");
  } else if (!filters.phase && !filters.carryover && !filters.alert) {
    // Výchozí přehled je pracovní pohled na aktivní projekty. Dokončené a
    // zrušené zůstávají dohledatelné přes příslušné filtry.
    projectsQuery = projectsQuery.eq("state", "active");
    appointmentsQuery = appointmentsQuery.eq("status", "scheduled");
  }
  if (filters.phase) projectsQuery = projectsQuery.eq("phase", filters.phase);
  if (filters.processStage) {
    if (filters.processStage === "intro") {
      // Úvodní rozhovor je samostatná termínová položka, ne procesní fáze
      // projektu. V jednom filtru proto vrací jen tento typ appointmentu.
      projectsQuery = projectsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      appointmentsQuery = appointmentsQuery.eq("type", "intro");
    } else {
      projectsQuery = projectsQuery.eq("process_stage", filters.processStage);
      if (filters.processStage === "analysis") appointmentsQuery = appointmentsQuery.eq("type", "analysis");
      if (filters.processStage === "consulting") appointmentsQuery = appointmentsQuery.eq("type", "consulting");
    }
  }
  if (filters.carryover) projectsQuery = projectsQuery.eq("is_carryover", filters.carryover === "yes");
  if (filters.alert === "no_due") projectsQuery = projectsQuery.is("due_date", null).eq("state", "active");
  if (filters.alert === "overdue") {
    const currentDate = today();
    projectsQuery = projectsQuery.lt("due_date", currentDate).eq("state", "active");
    appointmentsQuery = appointmentsQuery.lt("due_date", currentDate).eq("status", "scheduled");
  }

  // Po termínu se vztahuje i na samostatné analýzy, poradenství a úvodní
  // rozhovory. Jen projektové vlastnosti jejich načtení vylučují.
  const projectOnlyFilter = Boolean(filters.phase || filters.carryover || filters.alert === "no_due" || filters.processStage === "project");

  const [reportsResult, projectsResult, appointmentsResult] = await Promise.all([
    reportsQuery,
    projectsQuery,
    projectOnlyFilter ? Promise.resolve({ data: [], error: null }) : appointmentsQuery,
  ]);
  if (reportsResult.error) throw reportsResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (appointmentsResult.error) throw appointmentsResult.error;

  const rawReports = reportsResult.data ?? [];
  const matchesSelectedPeriod = (item: { due_date: string | null; period_start: string; period_end: string; is_carryover?: boolean }) => {
    if (!filters.periodStart && !filters.periodEnd) return true;
    // Nové projekty a termíny patří podle data do období, ve kterém mají
    // proběhnout. Přepad naopak patří do svého nového období, i když mu
    // původní termín už uplynul.
    if (item.due_date && !item.is_carryover) {
      return (!filters.periodStart || item.due_date >= filters.periodStart)
        && (!filters.periodEnd || item.due_date <= filters.periodEnd);
    }
    return (!filters.periodStart || item.period_end >= filters.periodStart)
      && (!filters.periodEnd || item.period_start <= filters.periodEnd);
  };
  const rawProjects = projectsResult.data ?? [];
  const carriedProjectIds = new Set(rawProjects.flatMap((project) => project.previous_project_id ? [project.previous_project_id] : []));
  const visibleProjects = filters.periodStart || filters.periodEnd
    ? rawProjects
    : rawProjects.filter((project) => !carriedProjectIds.has(project.id));
  const projects = visibleProjects.filter(matchesSelectedPeriod);
  const appointments = (appointmentsResult.data ?? []).filter(matchesSelectedPeriod);
  const countByReport = new Map<string, number>();
  for (const project of projects) if (project.source_report_id) countByReport.set(project.source_report_id, (countByReport.get(project.source_report_id) ?? 0) + 1);
  for (const appointment of appointments) if (appointment.report_id) countByReport.set(appointment.report_id, (countByReport.get(appointment.report_id) ?? 0) + 1);
  // Odvozené reporty i všechny metriky vycházejí z přesně stejné, již
  // filtrované množiny položek. Díky tomu se seznam, součty a termíny nerozejdou.
  const hasItemFilter = Boolean(filters.periodStart || filters.periodEnd || filters.from || filters.to || filters.state || filters.processStage || filters.alert || projectOnlyFilter);
  const reports = rawReports.filter((report) => !hasItemFilter || (countByReport.get(report.id) ?? 0) > 0);

  const activeProjects = projects.filter((project) => project.state === "active");
  const activeConsulting = appointments.filter((appointment) => appointment.type === "consulting" && appointment.status === "scheduled");
  const projectVolumeWithDueDate = activeProjects
    .filter((project) => Boolean(project.due_date))
    .reduce((total, project) => total + (project.value === null ? 0 : Number(project.value)), 0)
    + activeConsulting
      .filter((appointment) => Boolean(appointment.due_date))
      .reduce((total, appointment) => total + (appointment.value_bu === null ? 0 : Number(appointment.value_bu)), 0);
  const projectVolumeWithoutDueDate = activeProjects
    .filter((project) => !project.due_date)
    .reduce((total, project) => total + (project.value === null ? 0 : Number(project.value)), 0)
    + activeConsulting
      .filter((appointment) => !appointment.due_date)
      .reduce((total, appointment) => total + (appointment.value_bu === null ? 0 : Number(appointment.value_bu)), 0);
  const hasProjectFilter = Boolean(filters.userId || filters.periodStart || filters.periodEnd || filters.from || filters.to || filters.state || filters.phase || filters.processStage || filters.carryover || filters.alert);
  const projectVolumes = projects.reduce<Record<string, number>>((totals, project) => {
    if (project.value !== null && project.unit) totals[project.unit] = (totals[project.unit] ?? 0) + Number(project.value);
    return totals;
  }, {});
  // Poradenství je součástí objemu projektů a už je filtrováno stejnou logikou
  // jako tabulka položek (ve výchozím pohledu pouze domluvené termíny).
  for (const appointment of appointments) {
    if (appointment.type === "consulting" && appointment.value_bu !== null) {
      projectVolumes.BU = (projectVolumes.BU ?? 0) + Number(appointment.value_bu);
    }
  }
  // Termín projektu patří do kalendáře bez ohledu na jeho procesní fázi.
  // Analýza a poradenství vzniklé posunem jsou stále tentýž záznam v
  // reporting_projects; nesmí proto zmizet jen proto, že nejsou samostatnou
  // schůzkou v reporting_appointments. Starší samostatné termíny zachováváme
  // vedle nich kvůli historii a ručně zadaným záznamům.
  const upcoming = [
    ...projects
      .filter((project) => project.state === "active" && project.due_date && project.due_date >= today())
      .map((project) => ({
        id: project.id,
        type: (project.is_carryover ? "fall" : "project") as "fall" | "project",
        processStage: project.process_stage as "project" | "analysis" | "consulting",
        personName: project.name,
        description: project.description,
        dueDate: project.due_date,
        dueTime: project.due_time ? String(project.due_time).slice(0, 5) : null,
        owner: profileById.get(project.owner_id)?.name ?? "",
      })),
    ...appointments
      .filter((item) => item.status === "scheduled" && item.due_date && item.due_date >= today())
      .map((item) => ({
        id: item.id,
        type: item.type as "analysis" | "consulting" | "intro",
        processStage: null,
        personName: item.client_name,
        description: item.description,
        dueDate: item.due_date,
        dueTime: item.due_time ? String(item.due_time).slice(0, 5) : null,
        owner: profileById.get(item.owner_id)?.name ?? "",
      })),
  ]
    .sort((left, right) => `${left.dueDate ?? ""}T${left.dueTime ?? "00:00"}`.localeCompare(`${right.dueDate ?? ""}T${right.dueTime ?? "00:00"}`))
    .slice(0, 12);

  return {
    metrics: {
      activeProjects: activeProjects.length,
      projectCountLabel: hasProjectFilter ? "Projekty ve výběru" : "Aktivní projekty",
      projectVolumeWithDueDate,
      projectVolumeWithoutDueDate,
      projectVolumes,
      falls: projects.filter((project) => project.is_carryover).length,
      upcomingMeetings: upcoming.length,
      noDueProjects: activeProjects.filter((project) => !project.due_date).length,
      overdueProjects: activeProjects.filter((project) => project.due_date && project.due_date < today()).length,
    },
    reports: reports.slice(0, 50).map((report) => ({
      id: report.id,
      userId: report.user_id,
      userName: profileById.get(report.user_id)?.name ?? "Neznámý uživatel",
      userEmail: profileById.get(report.user_id)?.email ?? "",
      periodStart: report.period_start,
      periodEnd: report.period_end,
      summary: report.summary,
      syncStatus: report.sync_status,
      itemCount: countByReport.get(report.id) ?? 0,
      createdAt: report.created_at,
      canDelete: user.role === "admin" || report.user_id === user.id,
    })),
    upcoming,
    people: profiles.map((profile) => ({ id: profile.id, name: profile.name, email: profile.email })),
    items: [
      ...projects.map((project) => ({
        id: project.id,
        reportId: project.source_report_id,
        type: (project.is_carryover ? "fall" : "project") as "fall" | "project",
        personName: project.name,
        description: project.description,
        amount: project.value === null ? null : Number(project.value),
        unit: project.unit,
        dueDate: project.due_date,
        dueTime: project.due_time ? String(project.due_time).slice(0, 5) : null,
        status: project.state,
        phase: project.phase,
        processStage: project.process_stage as "project" | "analysis" | "consulting",
        note: project.cancellation_reason ?? "",
        owner: profileById.get(project.owner_id)?.name ?? "",
        ownerId: project.owner_id,
        isCarryover: project.is_carryover,
        canEdit: user.canManageReports || project.owner_id === user.id,
        canDelete: !project.is_carryover && (user.canManageReports || project.owner_id === user.id),
      })),
      ...appointments.map((item) => ({
        id: item.id,
        reportId: item.report_id,
        type: item.type as "analysis" | "consulting" | "intro",
        personName: item.client_name,
        description: item.description,
        amount: item.value_bu === null ? null : Number(item.value_bu),
        unit: item.type === "consulting" ? "BU" : null,
        dueDate: item.due_date,
        dueTime: item.due_time ? String(item.due_time).slice(0, 5) : null,
        status: item.status,
        phase: null,
        processStage: null,
        note: item.note,
        owner: profileById.get(item.owner_id)?.name ?? "",
        ownerId: item.owner_id,
        isCarryover: false,
        canEdit: user.canManageReports || item.owner_id === user.id,
        canDelete: user.canManageReports || item.owner_id === user.id,
      })),
    ],
  };
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  // Datum termínu ukládáme jako ISO řetězec. Sestavíme proto i dnešek
  // explicitně jako YYYY-MM-DD; formát `en-CA` není mezi runtime vždy stejný.
  return `${part("year")}-${part("month")}-${part("day")}`;
}
