import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import DashboardApp from "@/components/DashboardApp";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";
import { FIRST_REPORTING_PERIOD_START, reportingPeriodsAround } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const reportingPeriods = reportingPeriodsAround().filter((period) => period.start >= FIRST_REPORTING_PERIOD_START);
  // Přehled se otevírá na aktuálním reportovacím období; "Celkový přehled" ukáže vše.
  const currentPeriod = reportingPeriods.find((period) => period.relation === "current");
  const data = await getDashboardData(user, currentPeriod ? { periodStart: currentPeriod.start, periodEnd: currentPeriod.end } : undefined);
  return <><AppHeader user={user} /><DashboardApp user={user} initialData={data} reportingPeriods={reportingPeriods} /></>;
}
