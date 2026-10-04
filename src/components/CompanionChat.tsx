import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BrainCircuit,
  CircleStop,
  Database,
  MessageSquare,
  Plus,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { command, useConnection, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import { ActionButton } from "./ActionButton";
import StatusBadge from "./StatusBadge";
export default function CompanionChat() {
  const state = useRuntime();
  const { connected } = useConnection();
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const blocked =
    !connected ||
    state.adminOpen ||
    state.paused ||
    state.emergency ||
    state.engine !== "READY";
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.messages.length]);
  const send = async () => {
    if (!input.trim() || blocked || sending || state.host.busy) return;
    setSending(true);
    try {
      await command("run", {
        capability: "chat.send",
        action: "send",
        target: "companion/chat",
        input,
      });
      setInput("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
      <Widget
        title={state.companion.name}
        description="Private conversation · Local intelligence"
        action={
          <StatusBadge tone={blocked ? "warning" : "good"}>
            {blocked ? "Not ready" : "Ready to talk"}
          </StatusBadge>
        }
      >
        <div
          role="log"
          aria-label="Conversation"
          className="h-[390px] space-y-5 overflow-y-auto border-t py-6 pr-2"
        >
          {state.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-5 rounded-2xl bg-emerald-50 p-5">
                <BrainCircuit
                  className="h-9 w-9 text-primary"
                  strokeWidth={1.3}
                />
              </div>
              <h3 className="text-lg font-medium">
                A space to think together.
              </h3>
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
                Your conversation runs on this host. Start with an idea, a
                question, or something you want to explore.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {["Introduce yourself", "Help me plan my day"].map((text) => (
                  <Button
                    key={text}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setInput(text)}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            state.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60"}`}
                >
                  <p className="mb-1.5 text-[10px] font-medium opacity-60">
                    {msg.role === "user" ? "You" : state.companion.name}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {msg.text}
                  </p>
                </div>
              </div>
            ))
          )}
          {sending && (
            <p
              role="status"
              className="animate-pulse text-xs text-muted-foreground"
            >
              Generating locally…
            </p>
          )}
          <div ref={end} />
        </div>
        {blocked && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {state.adminOpen ? (
              "Close the administrator session to continue."
            ) : state.paused || state.emergency ? (
              "Resume your companion from Overview after releasing isolation."
            ) : (
              <>
                Load your local model in{" "}
                <Link className="underline" to="/engine">
                  Local engine
                </Link>{" "}
                to start a conversation.
              </>
            )}
          </div>
        )}
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            aria-label="Message your companion"
            value={input}
            maxLength={4000}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message your companion…"
            className="min-h-24 resize-none bg-muted/20 pb-10 pr-12 text-sm"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="absolute bottom-3 left-3 text-[10px] text-muted-foreground">
            Local inference · Enter to send
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={blocked || sending || state.host.busy || !input.trim()}
            className="absolute bottom-2.5 right-2.5 h-8 w-8"
          >
            <ArrowUp size={17} />
          </Button>
        </form>
        {(sending || state.host.busy) && (
          <ActionButton
            size="sm"
            variant="ghost"
            className="mt-2"
            action={() => command("cancel")}
          >
            <CircleStop size={14} className="mr-2" />
            Cancel generation
          </ActionButton>
        )}
      </Widget>
      <div className="space-y-6">
        <Widget
          title="Companion Home"
          description="Durable memory, independent of the AI engine."
          action={<Database size={16} className="text-primary" />}
        >
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-2xl font-medium">
                {state.companion.memories.length}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Saved memories
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-2xl font-medium">
                {state.messages.filter((m) => m.role === "user").length}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Conversation turns
              </p>
            </div>
          </div>
          <label htmlFor="memory" className="text-xs font-medium">
            Save a memory
          </label>
          <Textarea
            id="memory"
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Something worth remembering…"
            className="mb-3 mt-2 text-xs"
          />
          <ActionButton
            className="w-full"
            variant="outline"
            disabled={
              !note.trim() ||
              state.adminOpen ||
              state.paused ||
              state.emergency ||
              state.host.busy
            }
            action={async () => {
              await command("run", {
                capability: "home.write",
                action: "write",
                target: "companion/home",
                input: note,
              });
              setNote("");
              toast.success("Memory saved to Companion Home");
            }}
          >
            <Plus size={14} className="mr-2" />
            Save memory
          </ActionButton>
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Requires the Write companion Home capability. Disabled requests are
            recorded in Operations.
          </p>
        </Widget>
        <Widget title="Identity & continuity">
          <div className="space-y-4 text-xs">
            <div>
              <p className="text-muted-foreground">Companion identity</p>
              <p className="mt-1.5 break-all font-mono text-[11px]">
                {state.companion.id}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Origin</p>
              <p className="mt-1.5">{state.companion.source}</p>
            </div>
            <div className="flex gap-2 border-t pt-4 text-muted-foreground">
              <MessageSquare size={14} className="shrink-0" />
              <p className="text-[11px] leading-relaxed">
                Recent context is selected within the model’s window. Older
                turns and durable memories remain in host storage.
              </p>
            </div>
          </div>
        </Widget>
      </div>
    </div>
  );
}
