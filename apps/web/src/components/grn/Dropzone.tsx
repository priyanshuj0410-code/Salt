import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * File intake for the Import surface: drag-and-drop, click-to-browse, and paste — the
 * last one matters because invoices often arrive as WhatsApp screenshots. Any type,
 * many at once. Hands the raw File[] to `onFiles`; the page decides what to do with them.
 */
export function Dropzone({
  onFiles,
  busy,
  busyLabel,
  accept = "application/pdf,image/*,.csv,text/csv",
}: {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  busyLabel?: string;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  // Paste a screenshot/file anywhere on the page → ingest it (the photographed-bill path).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busy) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        onFiles(files);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFiles, busy]);

  function pick(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!busy) pick(e.dataTransfer.files);
      }}
      className={cn(
        "cursor-pointer rounded-xl border border-dashed border-border bg-surface px-6 py-9 text-center transition-colors",
        drag && "border-primary bg-primary/5",
        busy && "pointer-events-none opacity-70",
      )}
    >
      <div className="mx-auto mb-2.5 grid size-10 place-items-center rounded-lg bg-surface-2 text-text-secondary">
        <FileUp className="size-5" />
      </div>
      {busy ? (
        <p className="text-sm font-medium">{busyLabel ?? "Uploading…"}</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-medium">Drop invoices here</span>, or <span className="text-primary">click to browse</span>
          </p>
          <p className="mt-1 text-xs text-text-tertiary">PDF · photo · CSV · many at once · or paste a screenshot</p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
        disabled={busy}
      />
    </div>
  );
}
