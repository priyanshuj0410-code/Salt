import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { BillingScreen } from "@/components/billing/BillingScreen";
import { LoginPage } from "@/components/auth/LoginPage";
import { OnboardingPage } from "@/components/auth/OnboardingPage";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppLayout } from "@/components/nav/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";

// Route-level code splitting. Only the counter (the cashier hot path) plus the
// auth/shell screens ship in the initial bundle; every owner-only screen — and
// its heavy deps (xlsx, papaparse, the GST/GRN logic) — loads on demand the
// first time it is visited. Keeps cold-start small on low-end shop PCs.
const OwnerHome = lazy(() => import("@/components/owner/OwnerHome").then((m) => ({ default: m.OwnerHome })));
const PartiesPage = lazy(() => import("@/components/parties/PartiesPage").then((m) => ({ default: m.PartiesPage })));
const PartyProfilePage = lazy(() => import("@/components/parties/PartyProfilePage").then((m) => ({ default: m.PartyProfilePage })));
const GrnListPage = lazy(() => import("@/components/grn/GrnListPage").then((m) => ({ default: m.GrnListPage })));
const GrnEntryPage = lazy(() => import("@/components/grn/GrnEntryPage").then((m) => ({ default: m.GrnEntryPage })));
const GrnDetailPage = lazy(() => import("@/components/grn/GrnDetailPage").then((m) => ({ default: m.GrnDetailPage })));
const BillHistoryPage = lazy(() => import("@/components/bills/BillHistoryPage").then((m) => ({ default: m.BillHistoryPage })));
const Gstr1Page = lazy(() => import("@/components/gst/Gstr1Page").then((m) => ({ default: m.Gstr1Page })));
const Gstr3bPage = lazy(() => import("@/components/gst/Gstr3bPage").then((m) => ({ default: m.Gstr3bPage })));
const PaymentsPage = lazy(() => import("@/components/payments/PaymentsPage").then((m) => ({ default: m.PaymentsPage })));
const MakePaymentPage = lazy(() => import("@/components/payments/MakePaymentPage").then((m) => ({ default: m.MakePaymentPage })));
const ImportPage = lazy(() => import("@/components/import/ImportPage").then((m) => ({ default: m.ImportPage })));
const SmartImportPage = lazy(() => import("@/components/import/smart/SmartImportPage").then((m) => ({ default: m.SmartImportPage })));
const OrgSettingsPage = lazy(() => import("@/components/settings/OrgSettingsPage").then((m) => ({ default: m.OrgSettingsPage })));

function PageFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

// Rendered inside AppLayout's <Outlet/>. The Suspense + ErrorBoundary live here
// (not at the top) so a lazy chunk load — or a crash in one screen — shows a
// localized fallback in the content area while the sidebar/top-bar chrome stays
// mounted and usable.
function AppContent() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <OfflineBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppLayout />}>
          <Route element={<AppContent />}>
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
              path="/purchases"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <GrnListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases/new"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <GrnEntryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchases/:id"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <GrnDetailPage />
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
              path="/gst"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <Gstr1Page />
                </ProtectedRoute>
              }
            />
            <Route
              path="/gst/gstr3b"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <Gstr3bPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/payments"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <PaymentsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/payments/make"
              element={
                <ProtectedRoute allowedRoles={["owner"]}>
                  <MakePaymentPage />
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
