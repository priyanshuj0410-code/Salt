import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { BillingScreen } from "@/components/billing/BillingScreen";
import { LoginPage } from "@/components/auth/LoginPage";
import { OnboardingPage } from "@/components/auth/OnboardingPage";
import { OwnerHome } from "@/components/owner/OwnerHome";
import { PartiesPage } from "@/components/parties/PartiesPage";
import { PartyProfilePage } from "@/components/parties/PartyProfilePage";
import { PurchaseEntryPage } from "@/components/parties/PurchaseEntryPage";
import { BillHistoryPage } from "@/components/bills/BillHistoryPage";
import { ImportPage } from "@/components/import/ImportPage";
import { OrgSettingsPage } from "@/components/settings/OrgSettingsPage";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppLayout } from "@/components/nav/AppLayout";

// Lazy-loaded so the heavy xlsx parser only loads on the smart-import page.
const SmartImportPage = lazy(() =>
  import("@/components/import/smart/SmartImportPage").then((m) => ({ default: m.SmartImportPage })),
);

function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<AppLayout />}>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <BillingScreen />
          </ProtectedRoute>
        }
      />
      <Route
        path="/owner"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <OwnerHome />
          </ProtectedRoute>
        }
      />
      <Route
        path="/parties"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PartiesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/parties/:id"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PartyProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/parties/:id/purchase"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PurchaseEntryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bills"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <BillHistoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/import"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <ImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/import/smart"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <SmartImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/organisation"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <OrgSettingsPage />
          </ProtectedRoute>
        }
      />
      </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
