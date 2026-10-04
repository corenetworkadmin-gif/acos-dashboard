import {
  Activity,
  Box,
  BrainCircuit,
  Cable,
  Cpu,
  LayoutDashboard,
  Settings2,
} from "lucide-react";
export const navigation = [
  { path: "/", name: "Overview", icon: LayoutDashboard },
  { path: "/companion", name: "Companion", icon: BrainCircuit },
  { path: "/capabilities", name: "Capabilities", icon: Cable },
  { path: "/engine", name: "Local engine", icon: Cpu },
  { path: "/operations", name: "Operations", icon: Activity },
  { path: "/relocation", name: "Relocation", icon: Box },
  { path: "/settings", name: "Settings", icon: Settings2 },
];
