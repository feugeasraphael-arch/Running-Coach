import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

/** Catches a render or lazy-import failure and offers a reload.
 *
 * Every route is React.lazy(), and Vite fingerprints its chunks. After a
 * rebuild an already-open tab still holds the old chunk names, so the next
 * navigation 404s the dynamic import -- which React surfaces as a render
 * error. Without this the whole tree unmounts to a blank white page, which
 * looks exactly like "the app is broken" rather than "this tab is stale".
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render failed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A failed dynamic import is almost always a stale tab after a rebuild.
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);

    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-14 text-center">
        <h2 className="text-lg font-semibold tracking-tight">{stale ? "This tab is out of date" : "Something broke while rendering"}</h2>
        <p className="max-w-md text-[13px] text-muted">
          {stale
            ? "Run Coach was rebuilt since you opened this page, so part of it could no longer be loaded. Reloading picks up the new build."
            : error.message}
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
