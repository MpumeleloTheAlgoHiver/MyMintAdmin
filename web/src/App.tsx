import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import CrmLayout from "@/components/CrmLayout";
import SignIn from "@/pages/SignIn";
import Team from "@/pages/Team";
import AppSettings from "@/pages/AppSettings";
import Clients from "@/pages/Clients";
import Strategies from "@/pages/Strategies";
import Eft from "@/pages/Eft";
import Compliance from "@/pages/Compliance";
import MintMornings from "@/pages/MintMornings";
import Emailers from "@/pages/Emailers";
import Settings from "@/pages/Settings";
import Studio from "@/pages/Studio";
import Factsheets from "@/pages/Factsheets";
import Investors from "@/pages/Investors";
import Placeholder from "@/pages/Placeholder";

const queryClient = new QueryClient();

function Shell() {
  const { loading, authed } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-r-transparent" />
      </div>
    );
  }
  if (!authed) return <SignIn />;

  return (
    <CrmLayout>
      <Routes>
        {/* Ported pages (real data). */}
        <Route path="/team" element={<Team />} />
        <Route path="/app-settings" element={<AppSettings />} />
        <Route path="/" element={<Clients />} />
        <Route path="/strategies" element={<Strategies />} />
        <Route path="/eft" element={<Eft />} />
        <Route path="/compliance" element={<Compliance />} />

        <Route path="/studio" element={<Studio />} />
        <Route path="/factsheets" element={<Factsheets />} />
        <Route path="/mint-mornings" element={<MintMornings />} />
        <Route path="/emailers" element={<Emailers />} />
        <Route path="/settings" element={<Settings />} />

        <Route path="/investors" element={<Investors />} />

        {/* Heavy pages — ported last with parity checks. */}
        <Route path="/dashboard" element={<Placeholder title="Dashboard" />} />
        <Route path="/orderbook" element={<Placeholder title="Order Book" />} />
        <Route path="*" element={<Placeholder title="Not Found" />} />
      </Routes>
    </CrmLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
