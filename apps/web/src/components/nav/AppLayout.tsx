import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useGoToNav } from "./useGoToNav";

/**
 * Persistent app shell for authenticated routes: a left navigation sidebar +
 * the routed screen. Per-route `ProtectedRoute` guards still apply inside the
 * Outlet, so unauthenticated/role-restricted access redirects as before.
 */
export function AppLayout() {
  useGoToNav();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
