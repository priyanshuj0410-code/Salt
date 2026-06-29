import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, Download, Inbox, Lock, LogOut, PanelLeft, Receipt, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LENS_V2 } from "@/lib/flags";
import { useLens } from "@/lib/lens/useLens";
import { NAV, type NavLeaf, type NavModule } from "./navConfig";
import { visibleSurfaces } from "./surfaceNav";
import { ShopSwitcher } from "./ShopSwitcher";

const COLLAPSE_KEY = "salt.nav.collapsed";

// Icon for the lens's persistent action (the verb derived from the user's atoms).
const ACTION_ICON: Record<string, typeof Receipt> = {
  Bill: Receipt,
  Find: Search,
  "Approve · Inbox": Inbox,
  Export: Download,
  "Sync + collect": RefreshCw,
};
const pathOf = (p?: string) => (p ? p.split("?")[0] : undefined);

function isModuleActive(mod: NavModule, current: string): boolean {
  if (pathOf(mod.path) === current) return true;
  return mod.children.some((c) => pathOf(c.path) === current);
}

const rowBase = "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm min-w-0";
const activeCls = "bg-sidebar-accent font-medium text-sidebar-accent-foreground";
const idleCls = "text-sidebar-foreground/80 hover:bg-sidebar-accent/60";
const disabledCls = "cursor-not-allowed text-sidebar-foreground/40";

function KeyChip({ k }: { k: string }) {
  return (
    <kbd className="ml-auto hidden h-4 min-w-4 items-center justify-center rounded border border-sidebar-border px-1 text-[10px] font-medium text-muted-foreground md:inline-flex">
      {k === "," ? "," : k.toUpperCase()}
    </kbd>
  );
}

function LeafRow({ leaf }: { leaf: NavLeaf }) {
  if (leaf.built && leaf.path) {
    return (
      <NavLink
        to={leaf.path}
        end={leaf.path === "/"}
        className={({ isActive }) => cn(rowBase, "pl-9", isActive ? activeCls : idleCls)}
      >
        <span className="truncate">{leaf.label}</span>
      </NavLink>
    );
  }
  return (
    <div className={cn(rowBase, "pl-9", disabledCls)} title="Not built yet">
      <span className="truncate">{leaf.label}</span>
      <Lock className="ml-auto size-3 shrink-0" />
    </div>
  );
}

function ModuleItem({ mod, current }: { mod: NavModule; current: string }) {
  const Icon = mod.icon;
  const [open, setOpen] = useState(() => isModuleActive(mod, current));

  return (
    <div>
      <div className="flex items-center">
        {mod.built && mod.path ? (
          <NavLink
            to={mod.path}
            end={mod.path === "/"}
            className={({ isActive }) => cn(rowBase, isActive ? activeCls : idleCls)}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{mod.label}</span>
            <KeyChip k={mod.key} />
          </NavLink>
        ) : (
          <div className={cn(rowBase, disabledCls)} title="Not built yet">
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{mod.label}</span>
            <KeyChip k={mod.key} />
          </div>
        )}
        {mod.children.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Collapse" : "Expand"}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {mod.children.map((c) => (
            <LeafRow key={c.label} leaf={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Collapsed rail: icon-only module shortcuts. */
function IconItem({ mod, current }: { mod: NavModule; current: string }) {
  const Icon = mod.icon;
  const active = isModuleActive(mod, current);
  const base = "flex items-center justify-center rounded-md p-2";
  if (mod.built && mod.path) {
    return (
      <NavLink to={mod.path} end={mod.path === "/"} title={mod.label} className={cn(base, active ? activeCls : idleCls)}>
        <Icon className="size-4" />
      </NavLink>
    );
  }
  return (
    <div className={cn(base, disabledCls)} title={`${mod.label} — not built yet`}>
      <Icon className="size-4" />
    </div>
  );
}

/**
 * Left navigation. `expanded` forces the full width (used inside the mobile
 * drawer, which has no room for the collapse rail); `onNavigate` fires when a
 * link is clicked so the drawer can close itself.
 */
export function Sidebar({ expanded = false, onNavigate }: { expanded?: boolean; onNavigate?: () => void }) {
  const { membership, signOut } = useAuth();
  const role = membership?.role;
  const lens = useLens();
  const { pathname } = useLocation();
  const [localCollapsed, setLocalCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const collapsed = expanded ? false : localCollapsed;

  // V2 (WS2): the sidebar's top level is the 8 surfaces — the same visibleSurfaces
  // the go-to chords + command palette consume, so they never drift. V1 path
  // (role-default 13-module nav) is unchanged.
  const modules: NavModule[] = LENS_V2
    ? role == null
      ? [] // membership not resolved yet — match V1 (empty) instead of flashing
      : visibleSurfaces(lens)
    : NAV.filter((m) => role != null && m.roles.includes(role));

  const ActionIcon = ACTION_ICON[lens.persistentAction.label] ?? Search;

  const toggle = () =>
    setLocalCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2.5">
        {!collapsed && <span className="text-lg font-semibold tracking-tight">Salt</span>}
        {!expanded && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle sidebar"
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>

      {/* The one persistent action — the verb derived from the user's atoms (SALT-4 Slice 2). */}
      {LENS_V2 && lens.persistentAction.label !== "—" && (
        <div className="border-b border-sidebar-border p-2">
          <NavLink
            to={lens.persistentAction.route}
            onClick={onNavigate}
            title={lens.persistentAction.label}
            className={cn(
              "flex items-center gap-2 rounded-md bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90",
              collapsed && "justify-center",
            )}
          >
            <ActionIcon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{lens.persistentAction.label}</span>}
          </NavLink>
        </div>
      )}

      <nav
        onClick={(e) => onNavigate && (e.target as HTMLElement).closest("a") && onNavigate()}
        className={cn("flex-1 space-y-0.5 overflow-y-auto p-2", collapsed && "flex flex-col items-stretch")}
      >
        {modules.map((m) =>
          collapsed ? (
            <IconItem key={m.label} mod={m} current={pathname} />
          ) : (
            <ModuleItem key={m.label} mod={m} current={pathname} />
          ),
        )}
      </nav>

      {/* Footer: active-shop switcher (multi-shop orgs) + signed-in user.
          design.md — brand at top, user here, not on each screen. */}
      <div className="border-t border-sidebar-border p-2">
        {!collapsed && <ShopSwitcher />}
        {collapsed ? (
          <button
            type="button"
            onClick={() => signOut()}
            aria-label="Sign out"
            className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <LogOut className="size-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{membership?.orgName}</div>
              <div className="truncate text-[10px] capitalize text-muted-foreground">{membership?.role}</div>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              aria-label="Sign out"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent/60"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
