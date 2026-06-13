import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { apiGet } from "@/lib/api";

export interface TeamMember {
  email: string;
  full_name: string | null;
  role: "admin" | "staff";
  page_access: string[];
  id: string;
}

interface AuthState {
  loading: boolean;
  authed: boolean;
  member: TeamMember | null;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [member, setMember] = useState<TeamMember | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) { setAuthed(false); setLoading(false); }
        return;
      }
      // Reuse the existing team.js "me" endpoint for identity + role + page access.
      try {
        const me = await apiGet("/api/team?action=me");
        if (cancelled) return;
        if (me?.ok) {
          setAuthed(true);
          setMember({
            email: me.email,
            full_name: me.full_name ?? null,
            role: me.role || "staff",
            page_access: me.page_access || [],
            id: me.id,
          });
        } else {
          setAuthed(false);
        }
      } catch {
        if (!cancelled) setAuthed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <AuthCtx.Provider value={{ loading, authed, member, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
