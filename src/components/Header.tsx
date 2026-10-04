import { Link, NavLink } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Box,
  BrainCircuit,
  Cable,
  CircleHelp,
  Cpu,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { command, logout, useRuntime } from "@/runtime/store";
import { ActionButton } from "./ActionButton";
import { navigation } from "@/lib/navigation";

export function Header() {
  const [open, setOpen] = useState(false);
  const state = useRuntime();
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b bg-[#142b2a] px-5 text-white lg:hidden">
        <Link to="/" className="font-semibold tracking-[.18em]">
          ACOS
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <button
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#142b2a] text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Link
          to="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 px-7 pb-10 pt-9"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#7ed8bb]/40 bg-[#7ed8bb]/10">
            <Box className="h-5 w-5 text-[#a4e8d0]" />
          </div>
          <div>
            <span className="text-xl font-semibold tracking-[.18em]">ACOS</span>
            <p className="mt-0.5 text-[9px] uppercase tracking-[.19em] text-slate-400">
              Companion operating system
            </p>
          </div>
        </Link>
        <div className="px-7 text-[10px] font-medium uppercase tracking-[.16em] text-[#819c96]">
          Workspace
        </div>
        <nav aria-label="Main navigation" className="mt-4 space-y-1 px-4">
          {navigation.map(({ path, name, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-3 text-[13px] transition-colors ${isActive ? "bg-[#2b4740] text-[#c0f1da]" : "text-[#b3c5c0] hover:bg-white/5 hover:text-white"}`
              }
            >
              <Icon size={17} strokeWidth={1.7} />
              {name}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-5">
          <div className="rounded-lg border border-white/10 bg-white/[.025] p-4">
            <ShieldCheck className="mb-3 h-5 w-5 text-[#a5dfc6]" />
            <p className="text-xs font-medium">Authority stays with you.</p>
            <p className="mt-2 text-[11px] leading-relaxed text-[#97afa8]">
              One host. One companion.
              <br />
              Every action governed.
            </p>
            <Link
              to="/settings"
              className="mt-3 flex items-center gap-2 text-[11px] text-[#b9e8d1]"
            >
              Review system policy <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="mt-5 flex items-center justify-between text-[10px] text-[#819c96]">
            <span>HOST RUNTIME · v0.1</span>
            <CircleHelp size={14} />
          </div>
        </div>
      </aside>
    </>
  );
}
export function TopBar() {
  const state = useRuntime();
  return (
    <header className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Local host <span className="px-2 text-slate-300">/</span>
        <span className="font-medium text-foreground">Companion workspace</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded border bg-white px-2 py-1 font-mono text-[10px]">
          {state.mode} MODE
        </span>
        <ActionButton
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          action={logout}
        >
          <LogOut size={13} className="mr-1.5" />
          Lock
        </ActionButton>
      </div>
    </header>
  );
}
