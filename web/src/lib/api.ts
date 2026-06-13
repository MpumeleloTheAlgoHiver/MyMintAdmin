import { supabase } from "./supabase";

// Calls the CRM's existing serverless functions (api/*) with the current
// Supabase session as a Bearer token — exactly how the vanilla pages do it, so
// all existing server logic is reused unchanged. VITE_API_BASE lets local dev
// proxy to the deployed CRM; in production it's same-origin (relative /api).
const API_BASE = import.meta.env.VITE_API_BASE || "";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: await authHeaders() });
  return res.json();
}

export async function apiSend<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}
