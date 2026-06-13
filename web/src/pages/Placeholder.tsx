import { Construction } from "lucide-react";

/* Stand-in for CRM pages not yet ported to React. Keeps the shell + nav fully
   navigable while Fable ports each page to real data on the WN design system. */
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">This page hasn't been ported to the new design yet.</p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
        <Construction className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">{title} — coming soon</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          The existing CRM page still works at its original URL. This React version is pending port.
        </p>
      </div>
    </div>
  );
}
