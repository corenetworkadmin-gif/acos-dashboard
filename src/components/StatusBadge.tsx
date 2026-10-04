import { Badge } from "@/components/ui/badge";
export default function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warning" | "danger" | "neutral";
}) {
  const colors = {
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 whitespace-nowrap px-2 py-1 text-[10px] font-medium ${colors[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </Badge>
  );
}
