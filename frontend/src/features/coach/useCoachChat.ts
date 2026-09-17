import { useCallback, useRef, useState } from "react";

export type ToolStep = { name: string; label: string };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolStep[];
  error?: string;
  pending?: boolean;
};

type Event =
  | { type: "tool"; name: string; label: string }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "done" };

const uid = () => Math.random().toString(36).slice(2, 10);

/** Chat state + NDJSON streaming against POST /api/chat. The conversation is
 *  deliberately in-memory only: opening the page always starts from a blank slate. */
export function useCoachChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1])] : ms));

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      const history = [...messages.filter((m) => !m.error && m.content), { role: "user" as const, content }];
      setMessages((ms) => [
        ...ms,
        { id: uid(), role: "user", content },
        { id: uid(), role: "assistant", content: "", tools: [], pending: true },
      ]);
      setStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error((body && JSON.stringify(body.detail)) || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as Event;
            if (ev.type === "text") patchLast((m) => ({ ...m, content: m.content + ev.delta }));
            else if (ev.type === "tool") patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { name: ev.name, label: ev.label }] }));
            else if (ev.type === "error") patchLast((m) => ({ ...m, error: ev.message }));
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") patchLast((m) => ({ ...m, error: (err as Error).message }));
      } finally {
        patchLast((m) => ({ ...m, pending: false }));
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, streaming, send, stop, reset };
}
