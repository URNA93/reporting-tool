const REPORTING_TIME_ZONE = "Europe/Prague";

export type ReportingPeriod = {
  key: string;
  start: string;
  end: string;
  label: string;
  relation: "previous" | "current" | "future";
};

function pragueDateParts(reference: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month") - 1, day: value("day") };
}

function firstTuesday(year: number, month: number) {
  const firstDay = new Date(Date.UTC(year, month, 1, 12));
  const offset = (2 - firstDay.getUTCDay() + 7) % 7;
  firstDay.setUTCDate(1 + offset);
  return firstDay;
}

function dateValue(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function firstTuesdayOfMonth(year: number, month: number) {
  return dateValue(firstTuesday(year, month - 1));
}

export function reportingPeriodForClosingMonth(year: number, month: number) {
  const closingDate = firstTuesday(year, month - 1);
  const previousClosingDate = firstTuesday(year, month - 2);
  const periodStart = new Date(previousClosingDate);
  periodStart.setUTCDate(periodStart.getUTCDate() + 1);
  return [dateValue(periodStart), dateValue(closingDate)] as const;
}

export function currentReportingPeriod(reference = new Date()) {
  const today = pragueDateParts(reference);
  const todayValue = `${today.year}-${String(today.month + 1).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  let closingDate = firstTuesday(today.year, today.month);
  if (todayValue > dateValue(closingDate)) {
    closingDate = firstTuesday(today.year, today.month + 1);
  }
  return reportingPeriodForClosingMonth(
    closingDate.getUTCFullYear(),
    closingDate.getUTCMonth() + 1,
  );
}

export function reportingPeriodLabel(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(`${start}T12:00:00Z`))} – ${formatter.format(
    new Date(`${end}T12:00:00Z`),
  )}`;
}

export function reportingPeriodsAround(
  reference = new Date(),
  previousCount = 12,
  futureCount = 3,
): ReportingPeriod[] {
  const [, currentEnd] = currentReportingPeriod(reference);
  const [year, month] = currentEnd.split("-").map(Number);
  const currentClosingIndex = year * 12 + (month - 1);
  const periods: ReportingPeriod[] = [];

  for (let offset = -previousCount; offset <= futureCount; offset += 1) {
    const closingIndex = currentClosingIndex + offset;
    const closingYear = Math.floor(closingIndex / 12);
    const closingMonth = (closingIndex % 12 + 12) % 12;
    const [start, end] = reportingPeriodForClosingMonth(closingYear, closingMonth + 1);
    periods.push({
      key: end,
      start,
      end,
      label: reportingPeriodLabel(start, end),
      relation: offset < 0 ? "previous" : offset === 0 ? "current" : "future",
    });
  }

  return periods.reverse();
}

// Nejstarší období, které se nabízí ve filtru. Dřívější období aplikace nikdy
// neměla, takže by jen zbytečně natahovala seznam; nová se přidávají sama,
// jak čas plyne.
export const FIRST_REPORTING_PERIOD_START = "2026-08-05";
