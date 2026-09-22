export const POSITION_CODES = [
  "T",
  "FC",
  "FS",
  "HFC",
  "TM",
  "AM",
  "AD",
  "RD",
  "GD",
  "P",
  "GA1",
  "GA2",
  "GA3",
  "GA4",
  "GA5",
] as const;

export type PositionCode = (typeof POSITION_CODES)[number];

// Běžný uživatel si při aktivaci účtu může vybrat jen nemanažerskou pozici.
// TM a vyšší úrovně přidává a spravuje ručně administrátor.
export const SELF_REGISTRATION_POSITION_CODES = ["T", "FC", "FS", "HFC"] as const;
export type SelfRegistrationPositionCode = (typeof SELF_REGISTRATION_POSITION_CODES)[number];

export const MANAGED_POSITION_CODES = ["T", "FC", "FS", "HFC", "TM", "AM", "AD", "RD", "GD", "P"] as const;
export const MANAGER_POSITION_CODES = ["TM", "AM", "AD", "RD", "GD", "P"] as const;
export type AccessRole = "admin" | "manager" | "user";

export const POSITION_LABELS: Record<PositionCode, string> = {
  T: "Trainee",
  FC: "Financial Consultant",
  FS: "Financial Specialist",
  HFC: "Head Financial Consultant",
  TM: "Team Manager",
  AM: "Area Manager",
  AD: "Area Director",
  RD: "Regional Director",
  GD: "General Director",
  P: "Partner",
  GA1: "General Agent 1",
  GA2: "General Agent 2",
  GA3: "General Agent 3",
  GA4: "General Agent 4",
  GA5: "General Agent 5",
};

const MANAGER_POSITIONS = new Set<PositionCode>(MANAGER_POSITION_CODES);

export function isManagerPosition(position: PositionCode) {
  return MANAGER_POSITIONS.has(position);
}

export function canManageReportsFor(role: AccessRole, position?: PositionCode) {
  void position;
  return role === "admin" || role === "manager";
}
