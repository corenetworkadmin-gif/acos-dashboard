import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function Widget({
  title,
  children,
  className = "",
  action,
  description,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <Card className={`min-w-0 shadow-sm ${className}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-5">
        <div>
          <CardTitle className="text-base font-semibold tracking-tight">
            {title}
          </CardTitle>
          {description && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
