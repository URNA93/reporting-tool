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

export type DueSort = "none" | "asc" | "desc";

/**
 * Seřadí položky podle termínu (datum, při shodě čas). Položky bez termínu jsou
 * vždy na konci, ať se řadí vzestupně nebo sestupně. Řazení je stabilní, takže
 * položky se stejným termínem zůstanou ve výchozím pořadí.
 */
export function sortByDue<T extends { dueDate: string | null; dueTime: string | null }>(
  items: T[],
  direction: DueSort,
): T[] {
  if (direction === "none") return items;
  const sign = direction === "asc" ? 1 : -1;
  const key = (item: T) => `${item.dueDate}T${item.dueTime ?? "00:00"}`;
  return [...items].sort((left, right) => {
    if (!left.dueDate && !right.dueDate) return 0;
    if (!left.dueDate) return 1;
    if (!right.dueDate) return -1;
    return key(left).localeCompare(key(right)) * sign;
  });
}

export function nextDueSort(current: DueSort): DueSort {
  return current === "none" ? "asc" : current === "asc" ? "desc" : "none";
}

/** Popisek dne pro agendu: "Dnes" a "Zítra", jinak den v týdnu; datum je vždy zvlášť. */
export function dayLabel(isoDate: string, reference = new Date()) {
  const diff = dayNumber(isoDate) - dayNumber(todayInPrague(reference));
  const noon = new Date(`${isoDate}T12:00:00Z`);
  return {
    relative: diff === 0 ? "Dnes" : diff === 1 ? "Zítra" : null,
    weekday: new Intl.DateTimeFormat("cs-CZ", { weekday: "long", timeZone: "UTC" }).format(noon),
    date: new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(noon),
  };
}
