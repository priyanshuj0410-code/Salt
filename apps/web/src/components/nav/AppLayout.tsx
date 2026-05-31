import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useGoToNav } from "./useGoToNav";

/**
 * Persistent app shell for authenticated routes. Desktop (lg+): a persistent
 * left sidebar + the routed screen. Below lg: the sidebar collapses to an
 * off-canvas drawer opened from a slim top bar (touch-first). Per-route
 * ProtectedRoute guards still apply inside the Outlet.
 */
export function AppLayout() {
  useGoToNav();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on Escape (link clicks close it via the Sidebar onNavigate).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 shadow-lg">
            <Sidebar expanded onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar (the only top bar; screens render a PageHeader below) */}
        <header className="flex items-center gap-2 border-b border-border bg-background px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-base font-semibold tracking-tight">Salt</span>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
