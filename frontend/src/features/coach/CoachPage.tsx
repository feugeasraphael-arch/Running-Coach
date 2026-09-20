import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCoachChat, type ChatMessage } from "./useCoachChat";
import { ModelPicker, type CoachModel } from "./ModelPicker";

type ChatStatus = { configured: boolean; default_model: string; models: CoachModel[] };

const MODEL_KEY = "coach.model";

function readStoredModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

const SUGGESTIONS = [
  "What should I run tomorrow, given my recovery?",
  "How did my last interval session go?",
  "Is my sub-50-minute 10K goal realistic?",
  "Analyse my training load over the last month",
];

export function CoachPage() {
  const status = useQuery({
    queryKey: ["chat", "status"],
    queryFn: async () => (await fetch("/api/chat/status")).json() as Promise<ChatStatus>,
  });
  const [picked, setPicked] = useState<string | null>(readStoredModel);
  const models = status.data?.models ?? [];
  // A remembered model can disappear (key removed, model retired): fall back to the default.
  const model = models.some((m) => m.id === picked) ? picked! : status.data?.default_model;
  const currentModel = models.find((m) => m.id === model);
  const pickModel = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  };
  const { messages, streaming, send, stop, reset } = useCoachChat(model);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = (text = draft) => {
    if (!text.trim() || streaming) return;
    send(text);
    setDraft("");
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-3xl flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-tight">AI Coach</h1>
            <p className="text-xs text-muted">{currentModel ? `Mistral · ${currentModel.label}` : "Mistral"} · reads your live data</p>
          </div>
        </div>
        {!empty && (
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw /> New conversation
          </Button>
        )}
      </div>

      {status.data && !status.data.configured && (
        <p className="mb-4 flex gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          <TriangleAlert className="size-4 shrink-0" /> MISTRAL_API_KEY is not set in .env — the coach cannot answer.
        </p>
      )}

      <div className="flex-1">
        {empty ? (
          <div className="flex flex-col items-center pt-10 text-center sm:pt-16">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Sparkles className="size-6" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight">Ask your coach a question</h2>
            <p className="mt-1.5 max-w-md text-[13px] text-muted">
              It checks your recovery, training load, plan and sessions before answering.
            </p>
            <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-xl border border-line bg-surface p-3.5 text-left text-[13px] transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 pb-4" aria-live="polite">
            {messages.map((m) => (
              <Message key={m.id} m={m} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="sticky bottom-20 mt-4 md:bottom-4">
        <div className="rounded-2xl border border-line bg-surface p-2 shadow-card focus-within:border-line-strong">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Ask your question…"
            aria-label="Message to the coach"
            className="field-sizing-content max-h-40 min-h-9 w-full resize-none bg-transparent px-2 py-2 text-[14px] outline-none placeholder:text-subtle"
          />
          <div className="flex items-center justify-between gap-2">
            <ModelPicker models={models} value={model ?? ""} onChange={pickModel} disabled={streaming} />
            {streaming ? (
              <Button size="icon" onClick={stop} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button size="icon" variant="primary" onClick={() => submit()} disabled={!draft.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-subtle">The coach can be wrong — double-check before changing your plan.</p>
      </div>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14px] whitespace-pre-wrap text-accent-fg">{m.content}</div>
      </div>
    );
  }
  const thinking = m.pending && !m.content;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {!!m.tools?.length && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {m.tools.map((t, i) => {
              const running = m.pending && !m.content && i === m.tools!.length - 1;
              return (
                <li key={i} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
                  {running ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-good" />}
                  {t.label}
                </li>
              );
            })}
          </ul>
        )}
        {thinking && !m.tools?.length && (
          <div className="flex items-center gap-2 py-1 text-[13px] text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Thinking…
          </div>
        )}
        {m.content && (
          <div className="coach-prose">
            <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
          </div>
        )}
        {m.error && (
          <p className="mt-2 flex gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-xs text-bad">
            <TriangleAlert className="size-4 shrink-0" /> {m.error}
          </p>
        )}
      </div>
    </div>
  );
}
