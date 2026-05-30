import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, Lock, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { NAV, type NavLeaf, type NavModule } from "./navConfig";

const COLLAPSE_KEY = "salt.nav.collapsed";
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
    <kbd className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded border border-sidebar-border px-1 text-[10px] font-medium text-muted-foreground">
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

export function Sidebar() {
  const role = useAuth().membership?.role;
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  const modules = NAV.filter((m) => role != null && m.roles.includes(role));

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2.5">
        {!collapsed && <span className="text-lg font-semibold tracking-tight">Salt</span>}
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle sidebar"
          className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>
      <nav className={cn("flex-1 space-y-0.5 overflow-y-auto p-2", collapsed && "flex flex-col items-stretch")}>
        {modules.map((m) =>
          collapsed ? (
            <IconItem key={m.label} mod={m} current={pathname} />
          ) : (
            <ModuleItem key={m.label} mod={m} current={pathname} />
          ),
        )}
      </nav>
    </aside>
  );
}
