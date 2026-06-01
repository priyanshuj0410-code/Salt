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
const PoListPage = lazy(() => import("@/components/grn/PoListPage").then((m) => ({ default: m.PoListPage })));
const PoEntryPage = lazy(() => import("@/components/grn/PoEntryPage").then((m) => ({ default: m.PoEntryPage })));
const PoDetailPage = lazy(() => import("@/components/grn/PoDetailPage").then((m) => ({ default: m.PoDetailPage })));
const AutoPoPage = lazy(() => import("@/components/grn/AutoPoPage").then((m) => ({ default: m.AutoPoPage })));
const VendorSchemesPage = lazy(() => import("@/components/grn/VendorSchemesPage").then((m) => ({ default: m.VendorSchemesPage })));
const OcrInvoiceImportPage = lazy(() => import("@/components/grn/OcrInvoiceImportPage").then((m) => ({ default: m.OcrInvoiceImportPage })));
const DebitNoteListPage = lazy(() => import("@/components/grn/DebitNoteListPage").then((m) => ({ default: m.DebitNoteListPage })));
const DebitNoteEntryPage = lazy(() => import("@/components/grn/DebitNoteEntryPage").then((m) => ({ default: m.DebitNoteEntryPage })));
const DebitNoteDetailPage = lazy(() => import("@/components/grn/DebitNoteDetailPage").then((m) => ({ default: m.DebitNoteDetailPage })));
const BillHistoryPage = lazy(() => import("@/components/bills/BillHistoryPage").then((m) => ({ default: m.BillHistoryPage })));
const CreditNotesPage = lazy(() => import("@/components/bills/CreditNotesPage").then((m) => ({ default: m.CreditNotesPage })));
const ActivityPage = lazy(() => import("@/components/activity/ActivityPage").then((m) => ({ default: m.ActivityPage })));
const ApprovalsPage = lazy(() => import("@/components/approvals/ApprovalsPage").then((m) => ({ default: m.ApprovalsPage })));
const StockLedgerPage = lazy(() => import("@/components/inventory/StockLedgerPage").then((m) => ({ default: m.StockLedgerPage })));
const NearExpiryPage = lazy(() => import("@/components/inventory/NearExpiryPage").then((m) => ({ default: m.NearExpiryPage })));
const DeadStockPage = lazy(() => import("@/components/inventory/DeadStockPage").then((m) => ({ default: m.DeadStockPage })));
const ReorderPage = lazy(() => import("@/components/inventory/ReorderPage").then((m) => ({ default: m.ReorderPage })));
const OutOfStockPage = lazy(() => import("@/components/inventory/OutOfStockPage").then((m) => ({ default: m.OutOfStockPage })));
const TurnoverPage = lazy(() => import("@/components/inventory/TurnoverPage").then((m) => ({ default: m.TurnoverPage })));
const AdjustmentsPage = lazy(() => import("@/components/inventory/AdjustmentsPage").then((m) => ({ default: m.AdjustmentsPage })));
const PhysicalCountPage = lazy(() => import("@/components/inventory/PhysicalCountPage").then((m) => ({ default: m.PhysicalCountPage })));
const ExpiryDestructionPage = lazy(() => import("@/components/inventory/ExpiryDestructionPage").then((m) => ({ default: m.ExpiryDestructionPage })));
const TransfersPage = lazy(() => import("@/components/inventory/TransfersPage").then((m) => ({ default: m.TransfersPage })));
const Gstr1Page = lazy(() => import("@/components/gst/Gstr1Page").then((m) => ({ default: m.Gstr1Page })));
const Gstr3bPage = lazy(() => import("@/components/gst/Gstr3bPage").then((m) => ({ default: m.Gstr3bPage })));
const GstLiabilityPage = lazy(() => import("@/components/gst/GstLiabilityPage").then((m) => ({ default: m.GstLiabilityPage })));
const ItcRegisterPage = lazy(() => import("@/components/gst/ItcRegisterPage").then((m) => ({ default: m.ItcRegisterPage })));
const TallyExportPage = lazy(() => import("@/components/gst/TallyExportPage").then((m) => ({ default: m.TallyExportPage })));
const HsnReportPage = lazy(() => import("@/components/gst/HsnReportPage").then((m) => ({ default: m.HsnReportPage })));
const H1RegisterPage = lazy(() => import("@/components/gst/H1RegisterPage").then((m) => ({ default: m.H1RegisterPage })));
const PaymentsPage = lazy(() => import("@/components/payments/PaymentsPage").then((m) => ({ default: m.PaymentsPage })));
const MakePaymentPage = lazy(() => import("@/components/payments/MakePaymentPage").then((m) => ({ default: m.MakePaymentPage })));
const CatalogPage = lazy(() => import("@/components/catalog/CatalogPage").then((m) => ({ default: m.CatalogPage })));
const ItemDetailPage = lazy(() => import("@/components/catalog/ItemDetailPage").then((m) => ({ default: m.ItemDetailPage })));
const SalesmenPage = lazy(() => import("@/components/salesmen/SalesmenPage").then((m) => ({ default: m.SalesmenPage })));
const SalesmanDetailPage = lazy(() => import("@/components/salesmen/SalesmanDetailPage").then((m) => ({ default: m.SalesmanDetailPage })));
const DashboardPage = lazy(() => import("@/components/reports/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const SalesReportsPage = lazy(() => import("@/components/reports/SalesReportsPage").then((m) => ({ default: m.SalesReportsPage })));
const PurchaseReportsPage = lazy(() => import("@/components/reports/PurchaseReportsPage").then((m) => ({ default: m.PurchaseReportsPage })));
const InventoryReportsPage = lazy(() => import("@/components/reports/InventoryReportsPage").then((m) => ({ default: m.InventoryReportsPage })));
const FinancialReportsPage = lazy(() => import("@/components/reports/FinancialReportsPage").then((m) => ({ default: m.FinancialReportsPage })));
const TaxReportsPage = lazy(() => import("@/components/reports/TaxReportsPage").then((m) => ({ default: m.TaxReportsPage })));
const ImportPage = lazy(() => import("@/components/import/ImportPage").then((m) => ({ default: m.ImportPage })));
const PurchaseInvoiceImportPage = lazy(() => import("@/components/import/PurchaseInvoiceImportPage").then((m) => ({ default: m.PurchaseInvoiceImportPage })));
const GlOpeningImportPage = lazy(() => import("@/components/import/GlOpeningImportPage").then((m) => ({ default: m.GlOpeningImportPage })));
const OrgSettingsPage = lazy(() => import("@/components/settings/OrgSettingsPage").then((m) => ({ default: m.OrgSettingsPage })));
const SetupWizard = lazy(() => import("@/components/onboarding/SetupWizard").then((m) => ({ default: m.SetupWizard })));
const DrugLicensesPage = lazy(() => import("@/components/settings/DrugLicensesPage").then((m) => ({ default: m.DrugLicensesPage })));
const DataExportPage = lazy(() => import("@/components/settings/DataExportPage").then((m) => ({ default: m.DataExportPage })));
const PrintTemplatesPage = lazy(() => import("@/components/settings/PrintTemplatesPage").then((m) => ({ default: m.PrintTemplatesPage })));
const AuditLogPage = lazy(() => import("@/components/settings/AuditLogPage").then((m) => ({ default: m.AuditLogPage })));
const ShopsManagerPage = lazy(() => import("@/components/settings/ShopsManagerPage").then((m) => ({ default: m.ShopsManagerPage })));
const SmartImportPage = lazy(() => import("@/components/import/smart/SmartImportPage").then((m) => ({ default: m.SmartImportPage })));

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
        path="/activity"
        element={
          <ProtectedRoute>
            <ActivityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/approvals"
        element={
          <ProtectedRoute>
            <ApprovalsPage />
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
        path="/setup"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <SetupWizard />
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
        path="/purchases/orders"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PoListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/orders/new"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PoEntryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/orders/suggest"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <AutoPoPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/orders/:id"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PoDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/schemes"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <VendorSchemesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/scan"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <OcrInvoiceImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/returns"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DebitNoteListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/returns/new"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DebitNoteEntryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchases/returns/:id"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DebitNoteDetailPage />
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
        path="/bills/credit-notes"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <CreditNotesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <StockLedgerPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/near-expiry"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <NearExpiryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/dead-stock"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DeadStockPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/reorder"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <ReorderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/out-of-stock"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <OutOfStockPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/turnover"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <TurnoverPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/adjustments"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <AdjustmentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/count"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PhysicalCountPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/destruction"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <ExpiryDestructionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/transfers"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <TransfersPage />
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
        path="/gst/liability"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <GstLiabilityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst/itc"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <ItcRegisterPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst/tally"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <TallyExportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst/hsn"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <HsnReportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gst/h1"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <H1RegisterPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/sales"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <SalesReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/purchases"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PurchaseReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/inventory"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <InventoryReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/financial"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <FinancialReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/tax"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <TaxReportsPage />
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
        path="/catalogue"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <CatalogPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalogue/:id"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <ItemDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/salesmen"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <SalesmenPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/salesmen/:id"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <SalesmanDetailPage />
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
        path="/import/purchases"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PurchaseInvoiceImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/import/gl"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <GlOpeningImportPage />
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
      <Route
        path="/settings/shops"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <ShopsManagerPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/licenses"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DrugLicensesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/export"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <DataExportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/print"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <PrintTemplatesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/audit"
        element={
          <ProtectedRoute allowedRoles={["owner"]}>
            <AuditLogPage />
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
