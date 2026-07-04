"use client"

import * as React from "react"
import { ChevronsUpDown } from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"

import { cx, focusRing } from "@/components/tremor/utils"

/** Up-to-two-letter initials from the connected organisation name. */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "ORG"
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

/**
 * The connected-organisation card, now a dropdown: switch to another Xero org
 * (re-runs the OAuth org picker) or disconnect (clears the connection and its
 * data, returning the app to its connect-first state).
 */
export function OrgMenu({ tenantName }: { tenantName: string }) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  async function disconnect() {
    setBusy(true)
    try {
      await fetch("/api/disconnect", { method: "POST" })
    } finally {
      // Back to the connect-first screen, with fresh server state.
      window.location.href = "/"
    }
  }

  const itemClass = cx(
    "flex w-full items-center gap-x-2.5 rounded px-2 py-1.5 text-sm font-medium text-gray-700 transition",
    "hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-50",
    focusRing,
  )

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          "flex w-full items-center gap-x-2.5 rounded-md border border-gray-300 bg-white p-2 text-sm shadow-xs transition",
          "hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
          focusRing,
        )}
      >
        <span
          className="flex aspect-square size-8 items-center justify-center rounded bg-brand-green p-2 text-xs font-medium text-white"
          aria-hidden
        >
          {initialsFrom(tenantName)}
        </span>
        <div className="flex w-full items-center justify-between gap-x-3 truncate">
          <div className="truncate text-left">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-50">
              {tenantName}
            </p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              Xero organisation
            </p>
          </div>
          <ChevronsUpDown className="size-5 shrink-0 text-gray-400" aria-hidden />
        </div>
      </button>

      {open && (
        <div
          role="menu"
          className={cx(
            "absolute inset-x-0 top-full z-50 mt-1.5 rounded-md border border-gray-200 bg-white p-1 shadow-lg",
            "dark:border-white/10 dark:bg-brand-dark",
          )}
        >
          <a href="/api/connect" role="menuitem" className={itemClass}>
            <HugeiconsIcon
              icon={ArrowDataTransferHorizontalIcon}
              className="size-4 shrink-0 text-gray-400"
              aria-hidden
            />
            Switch organisation
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={disconnect}
            disabled={busy}
            className={cx(itemClass, "disabled:opacity-60")}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              className="size-4 shrink-0 text-gray-400"
              aria-hidden
            />
            {busy ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      )}
    </div>
  )
}
