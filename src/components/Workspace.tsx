import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Box, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Header, TopBar } from "./Header";
import { navigation } from "@/lib/navigation";
import { InterlockBanner } from "./AdminInterlockStatus";
import { login, refresh, useConnection } from "@/runtime/store";
const descriptions: Record<string, string> = {
  "/": "Your companion’s world, at a glance.",
  "/companion": "A conversation that stays close to home.",
  "/setup": "From a fresh install to your first conversation.",
  "/capabilities": "The boundary between what exists and what is permitted.",
  "/scheduler": "Autonomy without authority: every run is still mediated.",
  "/engine": "Local intelligence, governed by your host.",
  "/operations": "A traceable path from request to result.",
  "/relocation": "A new home. The same companion. Your authority.",
  "/settings": "Configure the environment your companion calls home.",
};
export default function Workspace() {
  const connection = useConnection();
  const location = useLocation();
  const [key, setKey] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 1500);
    return () => clearInterval(interval);
  }, []);
  if (!connection.data)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f6f3] px-5">
        <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-[#142b2a] p-3">
              <Box className="h-6 w-6 text-emerald-200" />
            </div>
            <span className="text-2xl font-semibold tracking-[.2em]">ACOS</span>
          </div>
          {connection.authRequired ? (
            <>
              <KeyRound className="mb-4 h-6 w-6 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome to your host.
              </h1>
              <p className="mb-6 mt-3 text-sm leading-relaxed text-muted-foreground">
                Unlock your companion workspace with the administrator key
                generated on this computer.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    await login(key, otp);
                    setOtp("");
                    setKey("");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label htmlFor="host-key" className="text-xs font-medium">
                  Administrator key
                </label>
                <Input
                  id="host-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className="mb-4 mt-2"
                  required
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={busy || !key}
                >
                  {busy ? "Unlocking…" : "Unlock workspace"}
                </Button>
                <label htmlFor="host-otp" className="text-xs font-medium">
                  Authenticator code (if enabled)
                </label>
                <Input
                  id="host-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  className="mb-4 mt-2"
                />
                {error && (
                  <p role="alert" className="mt-4 text-xs text-red-600">
                    {error}
                  </p>
                )}
              </form>
              <p className="mt-6 border-t pt-5 text-[11px] leading-relaxed text-muted-foreground">
                The key is in <code>admin.key</code> inside your host’s ACOS
                data directory. It is never included in model context.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">
                {connection.error
                  ? "Host is unavailable"
                  : "Connecting to your host…"}
              </h1>
              <p role="status" className="my-5 text-sm text-muted-foreground">
                {connection.error ?? "Checking the local ACOS runtime."}
              </p>
              {connection.error ? (
                <Button variant="outline" onClick={() => void refresh()}>
                  <RefreshCw size={15} className="mr-2" />
                  Retry connection
                </Button>
              ) : (
                <Loader2 className="animate-spin text-primary" />
              )}
            </>
          )}
        </div>
      </main>
    );
  const title =
    navigation.find((n) => n.path === location.pathname)?.name ??
    "Page not found";
  return (
    <div className="min-h-screen bg-[#f6f7f4] text-foreground">
      <Header />
      <main className="min-w-0 px-5 pb-8 pt-24 sm:px-8 lg:ml-60 lg:px-10 lg:pt-7">
        <div className="mx-auto max-w-[1320px]">
          <TopBar />
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[28px] font-semibold tracking-tight">
                {title}
              </h1>
              <p className="mt-2 text-xs text-muted-foreground">
                {descriptions[location.pathname]}
              </p>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
          {!connection.connected && (
            <div
              role="alert"
              className="mb-5 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              Host connection lost. Showing the last known state.{" "}
              {connection.error}
            </div>
          )}
          <InterlockBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
