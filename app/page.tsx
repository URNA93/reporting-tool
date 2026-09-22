import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import DashboardApp from "@/components/DashboardApp";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";
import { reportingPeriodsAround } from "@/lib/reporting-period";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const data = await getDashboardData(user);
  const reportingPeriods = reportingPeriodsAround();
  return <><AppHeader user={user} /><DashboardApp user={user} initialData={data} reportingPeriods={reportingPeriods} /></>;
}
