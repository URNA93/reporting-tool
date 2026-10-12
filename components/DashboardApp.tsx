"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  CircleGauge,
  FolderKanban,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { daysOverdue, nextDueSort, overdueLabel, sortByDue, type DueSort } from "@/lib/deadline";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SessionUser } from "@/lib/auth";
import type { ReportingPeriod } from "@/lib/reporting-period";

type ItemType = "project" | "fall" | "analysis" | "consulting" | "intro";
type CreatableType = Exclude<ItemType, "fall">;
type ItemStatus = "active" | "completed" | "scheduled" | "done" | "cancelled";
type ProjectPhase = "new" | "contact" | "analysis" | "offer" | "signature" | "processing";
type ProjectProcessStage = "project" | "analysis" | "consulting";
type ProcessFilter = ProjectProcessStage | "intro";
type ReportItemDraft = {
  localId: string;
  type: ItemType;
  personName: string;
  description: string;
  amount: number | null;
  unit: "BU" | null;
  dueDate: string | null;
  dueTime: string | null;
  status: ItemStatus;
  phase: ProjectPhase | null;
  processStage: ProjectProcessStage | null;
  note: string;
  ownerId: string | null;
};

const ITEMS_PER_PAGE = 20;
const SCHEDULE_PER_PAGE = 12;

type DashboardData = {
  metrics: {
    activeProjects: number;
    projectCountLabel: string;
    projectVolumeWithDueDate: number;
    projectVolumeWithoutDueDate: number;
    projectVolumes: Record<string, number>;
    falls: number;
    upcomingMeetings: number;
    noDueItems: number;
    overdueItems: number;
  };
  reports: Array<{
    id: string;
    userName: string;
    userEmail: string;
    periodStart: string;
    periodEnd: string;
    summary: string;
    syncStatus: "pending" | "synced" | "failed";
    itemCount: number;
    createdAt: string | Date;
    canDelete: boolean;
  }>;
  upcoming: Array<{
    id: string;
    type: ItemType;
    processStage: ProjectProcessStage | null;
    personName: string;
    description: string;
    dueDate: string | null;
    dueTime: string | null;
    owner: string;
  }>;
  people: Array<{ id: string; name: string; email: string }>;
  items: Array<{
    id: string;
    reportId: string | null;
    type: ItemType;
    personName: string;
    description: string;
    amount: number | null;
    unit: "BU" | null;
    dueDate: string | null;
    dueTime: string | null;
    status: ItemStatus;
    phase: ProjectPhase | null;
    processStage: ProjectProcessStage | null;
    note: string;
    owner: string;
    ownerId: string;
    isCarryover: boolean;
    canEdit: boolean;
    canDelete: boolean;
  }>;
};

const typeLabels: Record<ItemType, string> = {
  project: "Projekty",
  fall: "Přepady",
  analysis: "Analýzy",
  consulting: "Poradenství",
  intro: "Úvodní rozhovory",
};
const typeSingularLabels: Record<ItemType, string> = {
  project: "Projekt",
  fall: "Přepad",
  analysis: "Analýza",
  consulting: "Poradenství",
  intro: "Úvodní rozhovor",
};
const statusLabels: Record<ItemStatus, string> = {
  active: "Aktivní",
  completed: "Dokončeno",
  scheduled: "Domluveno",
  done: "Hotovo",
  cancelled: "Zrušeno",
};
const phaseLabels: Record<ProjectPhase, string> = {
  new: "Nový",
  contact: "Kontakt",
  analysis: "Analýza",
  offer: "Nabídka",
  signature: "Podpis",
  processing: "Zpracování",
};
const processStageLabels: Record<ProjectProcessStage, string> = {
  project: "Projekt",
  analysis: "Analýza",
  consulting: "Poradenství",
};
const processFilterLabels: Record<ProcessFilter, string> = {
  ...processStageLabels,
  intro: "Úvodní rozhovor",
};

function newItem(type: CreatableType): ReportItemDraft {
  return {
    localId: crypto.randomUUID(),
    type,
    personName: "",
    description: "",
    amount: null,
    unit: type === "project" || type === "consulting" ? "BU" : null,
    dueDate: null,
    dueTime: null,
    status: type === "project" ? "active" : "scheduled",
    phase: type === "project" ? "new" : null,
    processStage: type === "project" ? "project" : null,
    note: "",
    ownerId: null,
  };
}

export default function DashboardApp({
  user,
  initialData,
  reportingPeriods,
}: {
  user: SessionUser;
  initialData: DashboardData;
  reportingPeriods: ReportingPeriod[];
}) {
  const [data, setData] = useState(initialData);
  const [reportOpen, setReportOpen] = useState(false);
  const [activeType, setActiveType] = useState<CreatableType>("project");
  const [items, setItems] = useState<ReportItemDraft[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [processStageFilter, setProcessStageFilter] = useState("all");
  const [alertFilter, setAlertFilter] = useState("all");
  const currentPeriod = reportingPeriods.find((period) => period.relation === "current")!;
  const [start] = useState(currentPeriod.start);
  const [end] = useState(currentPeriod.end);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dashboardError, setDashboardError] = useState("");
  const [editDraft, setEditDraft] = useState<ReportItemDraft | null>(null);
  const [editError, setEditError] = useState("");
  const [processMessage, setProcessMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [movingStageId, setMovingStageId] = useState<string | null>(null);
  const [itemsPage, setItemsPage] = useState(1);
  const [schedulePage, setSchedulePage] = useState(1);
  const [dueSort, setDueSort] = useState<DueSort>("none");
  const [reportItemsEdit, setReportItemsEdit] = useState<{
    id: string;
    userName: string;
    periodStart: string;
    periodEnd: string;
  } | null>(null);

  const typeItems = useMemo(
    () => items.filter((item) => item.type === activeType),
    [items, activeType],
  );
  const personIds = useMemo(
    () => ["all", ...data.people.map((person) => person.id)],
    [data.people],
  );
  const reportItems = useMemo(
    () => reportItemsEdit ? data.items.filter((item) => item.reportId === reportItemsEdit.id) : [],
    [data.items, reportItemsEdit],
  );
  const itemsPageCount = Math.max(1, Math.ceil(data.items.length / ITEMS_PER_PAGE));
  const currentItemsPage = Math.min(itemsPage, itemsPageCount);
  const schedulePageCount = Math.max(1, Math.ceil(data.upcoming.length / SCHEDULE_PER_PAGE));
  const currentSchedulePage = Math.min(schedulePage, schedulePageCount);
  const scheduleItems = useMemo(
    () => data.upcoming.slice((currentSchedulePage - 1) * SCHEDULE_PER_PAGE, currentSchedulePage * SCHEDULE_PER_PAGE),
    [currentSchedulePage, data.upcoming],
  );
  const sortedItems = useMemo(() => sortByDue(data.items, dueSort), [data.items, dueSort]);
  const paginatedItems = useMemo(
    () => sortedItems.slice((currentItemsPage - 1) * ITEMS_PER_PAGE, currentItemsPage * ITEMS_PER_PAGE),
    [currentItemsPage, sortedItems],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadFreshDashboard() {
      const response = await fetch("/api/dashboard", {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
        signal: controller.signal,
      });
      if (!response.ok) {
        setDashboardError("Aktuální přehled se nepodařilo načíst. Obnov stránku nebo se znovu přihlas.");
        return;
      }
      setData((await response.json()) as DashboardData);
      setDashboardError("");
    }

    void loadFreshDashboard().catch((loadError: unknown) => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setDashboardError("Aktuální přehled se nepodařilo načíst. Obnov stránku nebo se znovu přihlas.");
    });
    return () => controller.abort();
  }, []);

  function personLabel(value: string) {
    if (value === "all") return "Všichni povolení";
    const person = data.people.find((entry) => entry.id === value);
    return person ? `${person.name} · ${person.email}` : "Vybraná osoba";
  }

  async function refresh(
    filters = true,
    overrides: Partial<{
      from: string;
      to: string;
      selectedUser: string;
      selectedPeriod: string;
      stateFilter: string;
      processStageFilter: string;
      alertFilter: string;
    }> = {},
  ) {
    const activeFilters = {
      from,
      to,
      selectedUser,
      selectedPeriod,
      stateFilter,
      processStageFilter,
      alertFilter,
      ...overrides,
    };
    const params = new URLSearchParams();
    if (filters && activeFilters.from) params.set("from", activeFilters.from);
    if (filters && activeFilters.to) params.set("to", activeFilters.to);
    if (filters && activeFilters.selectedUser !== "all") params.set("userId", activeFilters.selectedUser);
    if (filters && activeFilters.selectedPeriod !== "all") {
      const period = reportingPeriods.find((entry) => entry.key === activeFilters.selectedPeriod);
      if (period) {
        params.set("periodStart", period.start);
        params.set("periodEnd", period.end);
      }
    }
    if (filters && activeFilters.stateFilter !== "all") params.set("state", activeFilters.stateFilter);
    if (filters && activeFilters.processStageFilter !== "all") params.set("processStage", activeFilters.processStageFilter);
    if (filters && activeFilters.alertFilter !== "all") params.set("alert", activeFilters.alertFilter);
    const response = await fetch(`/api/dashboard?${params.toString()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) {
      setDashboardError("Aktuální přehled se nepodařilo načíst. Obnov stránku nebo se znovu přihlas.");
      return;
    }
    setData((await response.json()) as DashboardData);
    setItemsPage(1);
    setSchedulePage(1);
    setDashboardError("");
  }

  function choosePeriod(value: string) {
    setSelectedPeriod(value);
    setItemsPage(1);
  }

  async function clearFilters() {
    setFrom("");
    setTo("");
    setSelectedUser("all");
    setSelectedPeriod("all");
    setStateFilter("all");
    setProcessStageFilter("all");
    setAlertFilter("all");
    setDueSort("none");
    setItemsPage(1);
    await refresh(false);
  }

  async function activateNoDueFilter() {
    setAlertFilter("no_due");
    setItemsPage(1);
    await refresh(true, { alertFilter: "no_due" });
  }

  function updateItem(localId: string, patch: Partial<ReportItemDraft>) {
    setItems((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  }

  async function submitReport() {
    setError("");
    setMessage("");
    if (items.length === 0) {
      setError("Přidej alespoň jednu položku do reportu.");
      return;
    }
    setSending(true);
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        periodStart: start,
        periodEnd: end,
        summary: "",
        items: items.map((item) => ({
          type: item.type,
          personName: item.personName,
          description: item.description,
          amount: item.amount,
          unit: item.type === "project" || item.type === "consulting" ? "BU" : null,
          dueDate: item.dueDate,
          dueTime: item.dueTime,
          status: item.status,
          phase: item.phase,
          note: item.note,
        })),
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string;
      dashboard?: DashboardData;
    };
    setSending(false);
    if (!response.ok) {
      setError(result.error ?? "Report se nepodařilo uložit.");
      return;
    }
    setItems([]);
    setReportOpen(false);
    setMessage(result.message ?? "Report byl uložen.");
    if (result.dashboard) {
      setData(result.dashboard);
    } else {
      await refresh(false);
    }
  }

  function startEdit(item: DashboardData["items"][number]) {
    setEditError("");
    setProcessMessage("");
    setEditDraft({
      localId: item.id,
      type: item.type,
      personName: item.personName,
      description: item.description,
      amount: item.amount,
      unit: item.type === "project" || item.type === "consulting" ? "BU" : null,
      dueDate: item.dueDate,
      dueTime: item.dueTime,
      status: item.status,
      phase: item.phase,
      processStage: item.processStage,
      note: item.note,
      ownerId: item.ownerId,
    });
  }

  async function saveEdit() {
    if (!editDraft) return;
    setEditing(true);
    setEditError("");
    const response = await fetch("/api/report-items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: editDraft.localId,
        type: editDraft.type === "fall" ? "project" : editDraft.type,
        personName: editDraft.personName,
        description: editDraft.description,
        amount: editDraft.amount,
        unit: editDraft.type === "project" || editDraft.type === "consulting" ? "BU" : null,
        dueDate: editDraft.dueDate,
        dueTime: editDraft.dueTime,
        status: editDraft.status,
        phase: editDraft.phase,
        note: editDraft.note,
        ownerId: editDraft.ownerId,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setEditing(false);
    if (!response.ok) {
      setEditError(result.error ?? "Položku se nepodařilo upravit.");
      return;
    }
    setEditDraft(null);
    setMessage(result.message ?? "Položka byla upravena.");
    await refresh();
  }

  async function deleteReport(reportId: string) {
    if (!window.confirm("Odstranit report i všechny jeho položky z přehledu a Google tabulky?")) return;
    const response = await fetch("/api/reports", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!response.ok) return setMessage(result.error ?? "Report se nepodařilo odstranit.");
    setMessage(result.message ?? "Report byl odstraněn.");
    await refresh();
  }

  async function deleteItem(item: DashboardData["items"][number]) {
    if (!window.confirm(`Odstranit ${typeLabels[item.type].toLowerCase()} „${item.personName}“ z přehledu i Google tabulky?`)) return;
    const response = await fetch("/api/report-items", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: item.id, type: item.type }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!response.ok) return setMessage(result.error ?? "Položku se nepodařilo odstranit.");
    setMessage(result.message ?? "Položka byla odstraněna.");
    await refresh();
  }

  async function moveProcessStage(itemId: string, targetStage: ProjectProcessStage) {
    setMovingStageId(itemId);
    setMessage("");
    setEditError("");
    setProcessMessage("");
    try {
      const response = await fetch("/api/report-items/process-stage", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, targetStage }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        setEditError(result.error ?? "Procesní fázi se nepodařilo změnit.");
        return;
      }
      setEditDraft((current) => current ? { ...current, processStage: targetStage } : current);
      const nextMessage = result.message ?? "Procesní fáze byla změněna.";
      setProcessMessage(nextMessage);
      setMessage(nextMessage);
      await refresh();
    } catch {
      setEditError("Procesní fázi se nepodařilo změnit. Zkus to prosím znovu.");
    } finally {
      setMovingStageId(null);
    }
  }

  function prepareAnalysisForConsulting() {
    if (!editDraft || editDraft.type !== "analysis") return;
    setEditError("");
    setEditDraft({ ...editDraft, type: "consulting", unit: "BU", amount: editDraft.amount ?? null });
    setProcessMessage("Doplň objem poradenství v BU a případně uprav další termín. Přesun potvrdíš až uložením změn.");
  }

  function prepareConsultingForAnalysis() {
    if (!editDraft || editDraft.type !== "consulting" || user.role !== "admin") return;
    setEditError("");
    setEditDraft({ ...editDraft, type: "analysis", unit: null, amount: null });
    setProcessMessage("Poradenství bude vráceno do analýzy až po uložení změn.");
  }

  function openReportItems(report: DashboardData["reports"][number]) {
    const matchingItems = data.items.filter((item) => item.reportId === report.id);
    if (matchingItems.length === 0) {
      setMessage("V tomto reportu nejsou položky odpovídající aktuálním filtrům.");
      return;
    }
    if (matchingItems.length === 1) {
      startEdit(matchingItems[0]);
      return;
    }
    setReportItemsEdit({
      id: report.id,
      userName: report.userName,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
    });
  }

  return (
    <main className="workspace">
      <section className="workspace-title">
        <div>
          <span className="eyebrow"><CircleGauge /> REPORTING</span>
          <h1>Přehled týmu</h1>
          <p>Aktuální projekty a nejbližší termíny na jednom místě.</p>
        </div>
        <Button size="lg" className="primary-cta" onClick={() => setReportOpen(true)}>
          <Plus /> Nový report
        </Button>
      </section>

      {message && <div className="notice success">{message}</div>}
      {dashboardError && <div className="notice error" role="alert">{dashboardError}</div>}

      {user.canManageReports && (
        <section className="filter-bar" aria-label="Filtry přehledu">
          <label>Období
            <Select value={selectedPeriod} onValueChange={choosePeriod}>
              <SelectTrigger aria-label="Vybrat reportovací období"><SelectValue>{selectedPeriod === "all" ? "Všechna období" : reportingPeriods.find((period) => period.key === selectedPeriod)?.label}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechna období</SelectItem>
                {reportingPeriods.map((period) => <SelectItem key={period.key} value={period.key}>{period.relation === "current" ? "Aktuální · " : period.relation === "future" ? "Budoucí · " : ""}{period.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label>Od <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setItemsPage(1); }} /></label>
          <label>Do <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setItemsPage(1); }} /></label>
          <label className="person-filter">Reportér
            <Combobox
              items={personIds}
              value={selectedUser}
              onValueChange={(value) => { setSelectedUser(value ?? "all"); setItemsPage(1); }}
              itemToStringLabel={personLabel}
            >
              <ComboboxInput placeholder="Napiš jméno nebo e-mail…" aria-label="Filtrovat podle reportéra" showClear={false} />
              <ComboboxContent>
                <ComboboxEmpty>Nikdo nenalezen.</ComboboxEmpty>
                <ComboboxList>
                  {personIds.map((personId) => <ComboboxItem key={personId} value={personId}>{personLabel(personId)}</ComboboxItem>)}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </label>
          <label>Stav položky
            <Select value={stateFilter} onValueChange={(value) => { setStateFilter(value); setItemsPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Všechny stavy</SelectItem><SelectItem value="active">Aktivní</SelectItem><SelectItem value="completed">Dokončené</SelectItem><SelectItem value="cancelled">Zrušené</SelectItem></SelectContent></Select>
          </label>
          <label>Proces
            <Select value={processStageFilter} onValueChange={(value) => { setProcessStageFilter(value); setItemsPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Všechny procesy</SelectItem>{(Object.keys(processFilterLabels) as ProcessFilter[]).map((stage) => <SelectItem key={stage} value={stage}>{processFilterLabels[stage]}</SelectItem>)}</SelectContent></Select>
          </label>
          <label>Termín
            <Select value={alertFilter} onValueChange={(value) => { setAlertFilter(value); setItemsPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Všechny termíny</SelectItem><SelectItem value="with_due">S termínem</SelectItem><SelectItem value="no_due">Bez termínu</SelectItem><SelectItem value="overdue">Po termínu</SelectItem></SelectContent></Select>
          </label>
          <Button className="filter-apply" variant="outline" onClick={() => refresh()}><RefreshCw /> Použít</Button>
          <Button variant="ghost" onClick={clearFilters}>Celkový přehled</Button>
        </section>
      )}

      <section className="metric-grid" aria-label="Hlavní ukazatele">
        <article className="metric-card volume-card"><CircleGauge /><span>Objem v BU</span><strong>{formatVolumes(data.metrics.projectVolumes)}</strong></article>
        {user.canManageReports ? (
          <button type="button" className="metric-card volume-card metric-card-button" onClick={activateNoDueFilter}>
            <FolderKanban /><span>Objem projektů bez termínu</span><strong>{formatVolumes({ BU: data.metrics.projectVolumeWithoutDueDate })}</strong>
          </button>
        ) : (
          <article className="metric-card volume-card"><FolderKanban /><span>Objem projektů bez termínu</span><strong>{formatVolumes({ BU: data.metrics.projectVolumeWithoutDueDate })}</strong></article>
        )}
        <article className="metric-card accent"><CalendarClock /><span>Blízké termíny</span><strong>{data.metrics.upcomingMeetings}</strong></article>
      </section>
      {user.canManageReports && (data.metrics.noDueItems > 0 || data.metrics.overdueItems > 0) && (
        <div className="manager-warning">
          <strong>Vyžaduje akci:</strong> {data.metrics.noDueItems} aktivních položek bez termínu · {data.metrics.overdueItems} po termínu.{data.metrics.falls > 0 ? ` ${data.metrics.falls} položek je označeno jako přenesených z minulého období.` : ""}
        </div>
      )}

      <section className="panel items-panel">
        <div className="panel-heading"><div><span>AKTUÁLNÍ PRÁCE</span><h2>Položky</h2></div><FolderKanban /></div>
        {data.items.length === 0 ? (
          <div className="empty-state compact"><FolderKanban /><p>Zatím nejsou zapsané žádné položky.</p></div>
        ) : (
          <Table className="items-table">
            <colgroup>
              <col className="items-table-type" />
              <col className="items-table-client" />
              <col className="items-table-description" />
              <col className="items-table-value" />
              <col className="items-table-date" />
              <col className="items-table-status" />
              <col className="items-table-owner" />
              <col className="items-table-actions" />
            </colgroup>
            <TableHeader><TableRow><TableHead>Typ</TableHead><TableHead>Člověk / klient</TableHead><TableHead>Co se řeší</TableHead><TableHead>Kolik</TableHead><TableHead aria-sort={dueSort === "asc" ? "ascending" : dueSort === "desc" ? "descending" : "none"}>
                <button type="button" className="sort-button" onClick={() => { setDueSort(nextDueSort(dueSort)); setItemsPage(1); }} aria-label="Řadit podle termínu">
                  Termín {dueSort === "asc" ? <ArrowUp /> : dueSort === "desc" ? <ArrowDown /> : <ArrowUpDown />}
                </button>
              </TableHead><TableHead>Stav / proces</TableHead><TableHead>Reportér</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {paginatedItems.map((item) => (
                <TableRow key={item.id} className={daysOverdue(item) !== null ? "row-overdue" : undefined}>
                  <TableCell><span className={`item-type ${item.type === "fall" ? "project" : item.type}`}>{item.type === "fall" ? "Projekt" : typeLabels[item.type]}</span></TableCell>
                  <TableCell><strong>{item.personName}</strong></TableCell>
                  <TableCell>{item.description || item.note || "—"}</TableCell>
                  <TableCell>{formatItemValue(item)}</TableCell>
                  <TableCell>{item.dueDate ? `${formatDate(item.dueDate)}${item.dueTime ? ` · ${item.dueTime}` : ""}` : "—"}</TableCell>
                  <TableCell>{statusLabels[item.status]}{(() => { const overdue = daysOverdue(item); return overdue !== null ? <small className="overdue-note">{overdueLabel(overdue)}</small> : null; })()}{item.processStage && <small>Proces: {processStageLabels[item.processStage]}</small>}{item.isCarryover && <small className="carryover-note">Přenesený z minulého období</small>}</TableCell>
                  <TableCell>{item.owner}</TableCell>
                  <TableCell><div className="row-actions">{item.canEdit && <Button variant="ghost" size="sm" onClick={() => startEdit(item)}><Pencil /> Upravit</Button>}{item.canDelete && <Button variant="ghost" size="sm" onClick={() => deleteItem(item)}><Trash2 /> Smazat</Button>}</div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data.items.length > ITEMS_PER_PAGE && (
          <div className="table-pagination" aria-label="Stránkování položek">
            <Button variant="outline" size="sm" disabled={currentItemsPage === 1} onClick={() => setItemsPage((page) => Math.max(1, page - 1))}>Předchozí</Button>
            <span>Strana {currentItemsPage} z {itemsPageCount}</span>
            <Button variant="outline" size="sm" disabled={currentItemsPage === itemsPageCount} onClick={() => setItemsPage((page) => Math.min(itemsPageCount, page + 1))}>Další</Button>
          </div>
        )}
      </section>

      <section className="panel schedule-panel" aria-label="Nejbližší termíny">
        <div className="panel-heading"><div><span>DALŠÍ KROKY</span><h2>Nejbližší termíny</h2></div><CalendarClock /></div>
        <div className="schedule-list">
          {data.upcoming.length === 0 ? (
            <div className="empty-state compact"><CalendarClock /><p>Žádné naplánované projekty ani termíny.</p></div>
          ) : scheduleItems.map((item) => (
            <div className="schedule-item" key={item.id}>
              <time>{item.dueDate ? formatDay(item.dueDate) : "—"}<small>{item.dueTime ?? ""}</small></time>
              <div><span>{(item.type === "fall" && item.processStage
                ? `${typeSingularLabels.fall} · ${processStageLabels[item.processStage]}`
                : item.processStage
                  ? processStageLabels[item.processStage]
                  : typeSingularLabels[item.type]).toUpperCase()}</span><strong>{item.personName}</strong><p>{item.owner}</p></div>
            </div>
          ))}
        </div>
        {data.upcoming.length > SCHEDULE_PER_PAGE && (
          <div className="table-pagination" aria-label="Stránkování termínů">
            <Button variant="outline" size="sm" disabled={currentSchedulePage === 1} onClick={() => setSchedulePage((page) => Math.max(1, page - 1))}>Předchozí</Button>
            <span>Strana {currentSchedulePage} z {schedulePageCount}</span>
            <Button variant="outline" size="sm" disabled={currentSchedulePage === schedulePageCount} onClick={() => setSchedulePage((page) => Math.min(schedulePageCount, page + 1))}>Další</Button>
          </div>
        )}
      </section>

      <section className="dashboard-grid">
        <article className="panel reports-panel">
          <div className="panel-heading"><div><span>POSLEDNÍ ODEVZDÁNÍ</span><h2>Reporty</h2></div><UsersRound /></div>
          {data.reports.length === 0 ? (
            <div className="empty-state"><FolderKanban /><h3>Zatím tu nic není</h3><p>První odeslaný report se ukáže tady.</p></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Člověk</TableHead><TableHead>Období</TableHead><TableHead>Souhrn</TableHead><TableHead>Položky</TableHead><TableHead>Tabulka</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {data.reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell><strong>{report.userName}</strong><small>{report.userEmail}</small></TableCell>
                    <TableCell>{formatDate(report.periodStart)} – {formatDate(report.periodEnd)}</TableCell>
                    <TableCell className="report-summary-cell">{report.summary || "—"}</TableCell>
                    <TableCell>{report.itemCount}</TableCell>
                    <TableCell><span className={`status-pill ${report.syncStatus}`}>{report.syncStatus === "synced" ? "Zapsáno" : report.syncStatus === "failed" ? "Chyba" : "Čeká"}</span></TableCell>
                    <TableCell><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => openReportItems(report)}><Pencil /> Upravit</Button>{report.canDelete && <Button variant="ghost" size="sm" onClick={() => deleteReport(report.id)}><Trash2 /> Smazat</Button>}</div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </article>
      </section>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="report-dialog">
          <DialogHeader>
            <DialogTitle>Nový report</DialogTitle>
          <DialogDescription>Přidej konkrétní projekty a termíny. Aktivní projekty se po uzávěrce přenesou automaticky, bez ručního zadávání přepadů.</DialogDescription>
          </DialogHeader>
          <div className="period-grid">
            <label>Období od <Input type="date" value={start} readOnly aria-readonly="true" /></label>
            <label>Uzávěrka <Input type="date" value={end} readOnly aria-readonly="true" /></label>
          </div>
          <p className="period-note">Období se počítá automaticky: od dne po minulé uzávěrce do prvního úterý v měsíci včetně.</p>
          <Tabs value={activeType} onValueChange={(value) => setActiveType(value as CreatableType)}>
            <TabsList className="report-tabs">
              {(["project", "analysis", "consulting", "intro"] as CreatableType[]).map((type) => (
                <TabsTrigger key={type} value={type}>{typeLabels[type]} <span>{items.filter((item) => item.type === type).length}</span></TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="item-list">
            {typeItems.map((item) => (
              <ReportItemCard key={item.localId} item={item} onChange={(patch) => updateItem(item.localId, patch)} onRemove={() => setItems((current) => current.filter((entry) => entry.localId !== item.localId))} />
            ))}
            {typeItems.length === 0 && <div className="empty-item">Zatím žádná položka v části {typeLabels[activeType].toLowerCase()}.</div>}
          </div>
          <Button variant="outline" onClick={() => setItems((current) => [...current, newItem(activeType)])}><Plus /> Přidat: {typeSingularLabels[activeType]}</Button>
          {error && <p className="auth-message error" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>Zavřít</Button>
            <Button onClick={submitReport} disabled={sending}><Send /> {sending ? "Ukládám…" : "Odeslat report"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reportItemsEdit)} onOpenChange={(open) => !open && setReportItemsEdit(null)}>
        <DialogContent className="edit-dialog">
          <DialogHeader>
            <DialogTitle>Položky reportu</DialogTitle>
            <DialogDescription>
              {reportItemsEdit?.userName} · {reportItemsEdit && `${formatDate(reportItemsEdit.periodStart)} – ${formatDate(reportItemsEdit.periodEnd)}`}. Vyber položku, kterou chceš upravit.
            </DialogDescription>
          </DialogHeader>
          <div className="item-list">
            {reportItems.map((item) => (
              <Button key={item.id} variant="outline" className="w-full justify-between" onClick={() => { setReportItemsEdit(null); startEdit(item); }}>
                <span>{typeLabels[item.type]} · {item.personName}</span><Pencil />
              </Button>
            ))}
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setReportItemsEdit(null)}>Zavřít</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editDraft)} onOpenChange={(open) => !open && setEditDraft(null)}>
        <DialogContent className="report-dialog edit-dialog">
          <DialogHeader>
            <DialogTitle>Upravit položku</DialogTitle>
            <DialogDescription>Vlastní položku můžeš průběžně aktualizovat. Manažer a správce mohou upravovat položky v týmovém přehledu.</DialogDescription>
          </DialogHeader>
          {editDraft && (
            <>
              {editDraft.type === "analysis" && (
                <section className="process-stage-actions" aria-label="Posun analýzy">
                  <div><span>Další krok</span><strong>Analýza</strong><small>Otevře formulář poradenství, kde před uložením doplníš objem a další termín.</small></div>
                  <Button variant="outline" size="sm" onClick={prepareAnalysisForConsulting}>Přesunout do poradenství</Button>
                </section>
              )}
              {editDraft.type === "consulting" && user.role === "admin" && (
                <section className="process-stage-actions" aria-label="Vrácení poradenství do analýzy">
                  <div><span>Správce</span><strong>Poradenství</strong><small>Správce může položku vrátit do analýzy. Změna se potvrdí až uložením.</small></div>
                  <Button variant="ghost" size="sm" onClick={prepareConsultingForAnalysis}>Vrátit do analýzy</Button>
                </section>
              )}
              {editDraft.processStage && (
                <section className="process-stage-actions" aria-label="Procesní fáze projektu">
                  <div><span>Procesní fáze</span><strong>{processStageLabels[editDraft.processStage]}</strong><small>Posun procesu je nezávislý na poli Fáze níže.</small></div>
                  {editDraft.status === "active" ? <div className="row-actions">
                    {user.role === "admin" ? (Object.keys(processStageLabels) as ProjectProcessStage[]).filter((stage) => stage !== editDraft.processStage).map((stage) => <Button key={stage} variant={stage === "consulting" ? "outline" : "ghost"} size="sm" disabled={movingStageId === editDraft.localId} onClick={() => moveProcessStage(editDraft.localId, stage)}>Přesunout do {processStageLabels[stage].toLowerCase()}</Button>) : <>
                      {editDraft.processStage === "project" && <Button variant="outline" size="sm" disabled={movingStageId === editDraft.localId} onClick={() => moveProcessStage(editDraft.localId, "analysis")}>Přesunout do analýzy</Button>}
                      {editDraft.processStage === "analysis" && <Button variant="outline" size="sm" disabled={movingStageId === editDraft.localId} onClick={() => moveProcessStage(editDraft.localId, "consulting")}>Přesunout do poradenství</Button>}
                    </>}
                  </div> : <small>Dokončený nebo zrušený projekt už nelze v procesu posouvat.</small>}
                </section>
              )}
              {processMessage && <p className="auth-message success" role="status">{processMessage}</p>}
              <ReportItemCard
                item={editDraft}
                onChange={(patch) => setEditDraft({ ...editDraft, ...patch })}
                ownerChoices={user.canManageReports ? data.people : undefined}
              />
            </>
          )}
          {editError && <p className="auth-message error" role="alert">{editError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditDraft(null)}>Zrušit</Button>
            <Button onClick={saveEdit} disabled={editing}>{editing ? "Ukládám…" : "Uložit změny"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ReportItemCard({
  item,
  onChange,
  onRemove,
  ownerChoices,
}: {
  item: ReportItemDraft;
  onChange: (patch: Partial<ReportItemDraft>) => void;
  onRemove?: () => void;
  ownerChoices?: DashboardData["people"];
}) {
  const intro = item.type === "intro";
  const appointment = item.type === "analysis" || item.type === "consulting" || intro;
  const projectConsulting = item.type === "project" && item.processStage === "consulting";
  const statusOptions: ItemStatus[] = appointment
    ? ["scheduled", "done", "cancelled"]
    : ["active", "completed", "cancelled"];
  return (
    <div className="report-item-card">
      <div className="report-item-head"><strong>{typeSingularLabels[item.type]}</strong>{onRemove && <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Odstranit položku"><Trash2 /></Button>}</div>
      <div className="item-grid">
        <label>{appointment ? (intro ? "Jméno" : "Jméno klienta") : "Název projektu"}<Input value={item.personName} onChange={(event) => onChange({ personName: event.target.value })} placeholder={appointment ? "Jméno a příjmení" : "Konkrétní projekt"} /></label>
        {ownerChoices && <label>Řešitel
          <Select value={item.ownerId ?? undefined} onValueChange={(value) => onChange({ ownerId: value })}>
            <SelectTrigger><SelectValue placeholder="Vyber řešitele" /></SelectTrigger>
            <SelectContent>
              {ownerChoices.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>}
        {!intro && <label>{appointment ? "Téma" : "Projekt / popis"}<Input value={item.description} onChange={(event) => onChange({ description: event.target.value })} placeholder={appointment ? "Čeho se schůzka týká" : "Co je v řešení"} /></label>}
        {(item.type === "project" || item.type === "consulting") && <><label>{item.type === "consulting" ? "Objem poradenství" : "Objem projektu"}<Input type="number" min="0" step="0.01" value={item.amount ?? ""} onChange={(event) => onChange({ amount: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Jednotka<Input value="BU" readOnly aria-readonly="true" /></label></>}
        <label>Termín<Input type="date" value={item.dueDate ?? ""} onChange={(event) => onChange({ dueDate: event.target.value || null })} /></label>
        {(appointment || projectConsulting) && <label>Čas<Input type="time" value={item.dueTime ?? ""} onChange={(event) => onChange({ dueTime: event.target.value || null })} /></label>}
        {!appointment && <label>Fáze<Select value={item.phase ?? "new"} onValueChange={(value) => onChange({ phase: value as ProjectPhase })}><SelectTrigger><SelectValue>{phaseLabels[item.phase ?? "new"]}</SelectValue></SelectTrigger><SelectContent>{(Object.keys(phaseLabels) as ProjectPhase[]).map((phase) => <SelectItem key={phase} value={phase}>{phaseLabels[phase]}</SelectItem>)}</SelectContent></Select></label>}
        {!intro && <label>Stav<Select value={item.status} onValueChange={(value) => onChange({ status: value as ItemStatus })}><SelectTrigger><SelectValue>{statusLabels[item.status]}</SelectValue></SelectTrigger><SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}</SelectContent></Select></label>}
        <label className="wide-field">{item.status === "cancelled" && !appointment ? "Důvod zrušení" : "Poznámka"}<Input value={item.note} onChange={(event) => onChange({ note: event.target.value })} placeholder={item.status === "cancelled" && !appointment ? "Povinné" : "Volitelné"} /></label>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`));
}
function formatDay(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}
function formatVolumes(volumes: Record<string, number>) {
  const entries = Object.entries(volumes);
  if (entries.length === 0) return "0";
  return entries
    .map(([unit, amount]) => `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(amount)} ${unit}`)
    .join(" · ");
}

function formatItemValue(item: DashboardData["items"][number]) {
  if (item.amount === null) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(item.amount)} ${item.unit ?? ""}`;
}
