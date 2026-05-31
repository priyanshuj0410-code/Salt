import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Defaults to a reload card. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors and failed lazy-chunk fetches so one broken screen
 * — or a stale chunk fetched after a deploy — never white-screens the whole app.
 * A full reload re-fetches the current asset manifest, so the default fallback
 * offers Reload as the primary action. Used twice in App.tsx: once around the
 * whole router (last resort) and once inside the layout outlet (keeps the nav
 * chrome alive while showing a localized fallback in the content area).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stack traces only — never log request bodies or PII.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return <>{this.props.fallback}</>;
      return (
        <div
          role="alert"
          className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p className="text-sm font-medium text-foreground">Something went wrong.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            This page could not be loaded. It can happen right after an app update — reloading usually fixes it.
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
