import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { BillingScreen } from "@/components/billing/BillingScreen";
import { LoginPage } from "@/components/auth/LoginPage";
import { OnboardingPage } from "@/components/auth/OnboardingPage";
import { OwnerHome } from "@/components/owner/OwnerHome";
import { ImportPage } from "@/components/import/ImportPage";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
