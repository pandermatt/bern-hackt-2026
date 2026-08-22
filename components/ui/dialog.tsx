"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/*
 * The plain dialog, alongside `alert-dialog`.
 *
 * They are not interchangeable: an alert dialog is modal *and* interrupting —
 * it takes focus, traps Escape into an explicit choice, and is announced as an
 * alert. That is right for "delete this, are you sure" and wrong for a form,
 * where dismissing without choosing is a normal thing to want. Editing a
 * savings goal is a form, so it gets this one.
 *
 * Styled from `alert-dialog.tsx` rather than re-derived, so the two match.
 */

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        /*
         * **Top-anchored on a phone, centred from `sm`.** A dialog here is
         * always a form, and a form on a phone means the software keyboard:
         * that shrinks the *visual* viewport without touching the layout
         * viewport a `fixed` element resolves `top-1/2` against, so a centred
         * dialog stays put and the keyboard slides up over the field being
         * typed into. Anchored to the top, the fields sit above the keyboard
         * where they can be seen. It also fixes the taller case — centring
         * overflows a short screen equally in both directions, and the half
         * above the top edge cannot be scrolled back to.
         *
         * `max-h` with `overflow-y-auto` is the other half of that: `fixed`
         * does not scroll with the page, so without a ceiling a dialog taller
         * than the screen simply has an unreachable bottom. `dvh`, not `vh`,
         * because the mobile browser chrome moves.
         *
         * `w-[calc(100%-2rem)]` gives it the same 1rem inset at the sides as
         * `top-4` gives it above. `max-w-xs` won on a 320px screen before, so
         * the dialog was flush against both edges. From `sm` the max-widths
         * are far below this and nothing changes on a desk.
         */
        className={cn(
          "group/dialog-content fixed top-4 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xs -translate-x-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:top-1/2 sm:max-h-[calc(100dvh-4rem)] sm:max-w-sm sm:-translate-y-1/2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 cursor-pointer rounded-md p-1 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("grid gap-1.5 text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
