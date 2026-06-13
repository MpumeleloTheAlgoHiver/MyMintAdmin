import { createClient } from "@supabase/supabase-js";

// Same Supabase project the existing CRM pages use (public anon key — RLS-gated,
// service-role work happens server-side in the api/* functions). Overridable via
// env for other environments.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://mfxnghmuccevsxwcetej.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1meG5naG11Y2NldnN4d2NldGVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTI1ODAsImV4cCI6MjA4NDQyODU4MH0.lktfglzBMaHd79hLFDRH1HHSwsEwZ56Tv6e287kQiFg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
