import { createContext, useContext, useState, ReactNode } from "react";

export type Role = "founder" | "investor" | "admin" | "partner";
type Ctx = { role: Role; setRole: (r: Role) => void };
const RoleCtx = createContext<Ctx | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("founder");
  return <RoleCtx.Provider value={{ role, setRole }}>{children}</RoleCtx.Provider>;
}
export function useRole() {
  const c = useContext(RoleCtx);
  if (!c) throw new Error("RoleProvider missing");
  return c;
}
