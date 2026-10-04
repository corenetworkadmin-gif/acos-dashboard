import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Workspace from "@/components/Workspace";
import { AdminGate } from "@/components/AdminInterlockStatus";
import Index from "@/pages/Index";
import NotFound from "@/pages/NotFound";
import CompanionChat from "@/components/CompanionChat";
import CapabilityRegistry from "@/components/CapabilityRegistry";
import LocalAIEngineStatus from "@/components/LocalAIEngineStatus";
import OperationLog from "@/components/OperationLog";
import CompanionImport from "@/components/CompanionImport";
import SettingsPanel from "@/components/SettingsPanel";
export default function App() {
  return (
    <TooltipProvider>
      <Toaster richColors position="bottom-right" />
      <BrowserRouter>
        <Routes>
          <Route element={<Workspace />}>
            <Route path="/" element={<Index />} />
            <Route path="/companion" element={<CompanionChat />} />
            <Route
              path="/capabilities"
              element={
                <AdminGate>
                  <CapabilityRegistry />
                </AdminGate>
              }
            />
            <Route
              path="/engine"
              element={
                <AdminGate>
                  <LocalAIEngineStatus />
                </AdminGate>
              }
            />
            <Route
              path="/operations"
              element={
                <AdminGate>
                  <OperationLog />
                </AdminGate>
              }
            />
            <Route
              path="/relocation"
              element={
                <AdminGate>
                  <CompanionImport />
                </AdminGate>
              }
            />
            <Route
              path="/settings"
              element={
                <AdminGate>
                  <SettingsPanel />
                </AdminGate>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  );
}
