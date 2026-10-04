import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
export function ActionButton({
  action,
  children,
  ...props
}: ButtonProps & { action: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...props}
      disabled={props.disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await action();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Action failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
