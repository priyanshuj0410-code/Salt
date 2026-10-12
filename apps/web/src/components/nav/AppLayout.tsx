import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useGoToNav } from "./useGoToNav";
import { useGlobalShortcuts } from "@/lib/useGlobalShortcuts";
import { useUI } from "@/store/ui";
import { CommandPalette } from "@/components/command/CommandPalette";
import { ShortcutHelp } from "@/components/command/ShortcutHelp";

/**
 * Persistent app shell for authenticated routes. Desktop (lg+): a persistent
 * left sidebar + the routed screen. Below lg: the sidebar collapses to an
 * off-canvas drawer opened from a slim top bar (touch-first). Per-route
 * ProtectedRoute guards still apply inside the Outlet.
 */
export function AppLayout() {
  useGoToNav();
  useGlobalShortcuts();
  const openPalette = useUI((s) => s.openPalette);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on Escape (link clicks close it via the Sidebar onNavigate).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Skip to content — first focusable element so keyboard/SR users can bypass
          the sidebar (WCAG 2.4.1). Visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only rounded-lg border border-ring bg-background text-sm font-medium text-text-primary shadow-lg focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

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
          <span className="flex-1" />
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search and commands"
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
          >
            <Search className="size-5" />
          </button>
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
      <ShortcutHelp />
    </div>
  );
}
