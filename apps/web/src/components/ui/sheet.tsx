import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog as Sheet,
  DialogClose as SheetClose,
  DialogDescription as SheetDescription,
  DialogFooter as SheetFooter,
  DialogHeader as SheetHeader,
  DialogOverlay as SheetOverlay,
  DialogPortal as SheetPortal,
  DialogTitle as SheetTitle,
  DialogTrigger as SheetTrigger,
} from "@/components/ui/dialog"

/**
 * Responsive overlay (ADR 0015 §L6, "disclosure by density"): a **slide-up
 * bottom sheet** on touch / below `md`, and a **centered dialog** on `md+`.
 *
 * Built on the same `@base-ui/react` Dialog as {@link Dialog}, so it inherits
 * the focus-trap, `Esc`-to-close, and scrim-dismiss with no extra work — only
 * the Popup's position + entry animation are responsive. Drop-in shape:
 *
 * ```tsx
 * <Sheet open={open} onOpenChange={setOpen}>
 *   <SheetContent>
 *     <SheetHeader><SheetTitle>…</SheetTitle></SheetHeader>
 *     …
 *   </SheetContent>
 * </Sheet>
 * ```
 *
 * Swipe-to-dismiss on touch is a future enhancement (base-ui has no native drag;
 * the scrim + Esc + close button already give every user a dismiss path).
 */
function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          // Mobile (default): full-width bottom sheet that slides up.
          "fixed inset-x-0 bottom-0 z-50 grid max-h-[85vh] gap-4 overflow-y-auto rounded-t-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          // md+: centered dialog (same footprint as <DialogContent>).
          "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[calc(100vh-4rem)] md:w-full md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:data-open:zoom-in-95 md:data-open:slide-in-from-bottom-0 md:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </SheetPortal>
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
