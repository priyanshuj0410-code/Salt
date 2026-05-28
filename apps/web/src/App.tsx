import { Navigate, Route, Routes } from "react-router-dom";
import { BillingScreen } from "@/components/billing/BillingScreen";
import { LoginPage } from "@/components/auth/LoginPage";
import { OwnerHome } from "@/components/owner/OwnerHome";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
