const DEADLINE_TIME_ZONE = "Europe/Prague";

// Stavy, ve kterých položka ještě čeká na dokončení: projekt je aktivní,
// samostatná analýza/poradenství/úvodní rozhovor je domluvená.
const OPEN_STATUSES = new Set(["active", "scheduled"]);

export function todayInPrague(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEADLINE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Počet dnů po termínu, nebo null, pokud položka po termínu není.
 * "Po termínu" se nikdy neukládá jako fáze: je to odvozený stav
 * (otevřená položka s termínem před dneškem), takže se sám promítne, jakmile
 * termín uplyne, a zmizí, jakmile se položka dokončí nebo termín posune.
 */
export function daysOverdue(
  item: { dueDate: string | null; status: string },
  reference = new Date(),
) {
  if (!item.dueDate || !OPEN_STATUSES.has(item.status)) return null;
  const diff = dayNumber(todayInPrague(reference)) - dayNumber(item.dueDate);
  return diff > 0 ? diff : null;
}

export function isOverdue(
  item: { dueDate: string | null; status: string },
  reference = new Date(),
) {
  return daysOverdue(item, reference) !== null;
}

export function overdueLabel(days: number) {
  if (days === 1) return "Po termínu · 1 den";
  if (days >= 2 && days <= 4) return `Po termínu · ${days} dny`;
  return `Po termínu · ${days} dní`;
}
