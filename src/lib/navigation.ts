import {
  Activity,
  Box,
  BrainCircuit,
  Cable,
  CalendarClock,
  Cpu,
  LayoutDashboard,
  Settings2,
  Wand2,
} from "lucide-react";
export const navigation = [
  { path: "/", name: "Overview", icon: LayoutDashboard },
  { path: "/setup", name: "First-run setup", icon: Wand2 },
  { path: "/companion", name: "Companion", icon: BrainCircuit },
  { path: "/capabilities", name: "Capabilities", icon: Cable },
  { path: "/scheduler", name: "Scheduler", icon: CalendarClock },
  { path: "/engine", name: "Local engine", icon: Cpu },
  { path: "/operations", name: "Operations", icon: Activity },
  { path: "/relocation", name: "Relocation", icon: Box },
  { path: "/settings", name: "Settings", icon: Settings2 },
];
