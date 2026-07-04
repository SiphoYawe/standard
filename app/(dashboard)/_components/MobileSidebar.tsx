"use client"

import * as React from "react"
import { RiCloseLine, RiFundsLine, RiMenuLine } from "@remixicon/react"

import { cx, focusRing } from "@/components/tremor/utils"
import { navigation, shortcuts } from "./nav"

export function MobileSidebar() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cx(
          "inline-flex size-9 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
          focusRing,
        )}
      >
        <RiMenuLine className="size-5" aria-hidden />
      </button>

      {/* Overlay */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cx(
          "fixed inset-0 z-50 bg-gray-950/40 backdrop-blur-[1px] transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-y-6 border-r border-gray-200 bg-white p-4 shadow-xl transition-transform duration-300 ease-out lg:hidden dark:border-gray-800 dark:bg-gray-950",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
              <RiFundsLine className="size-5" aria-hidden />
            </span>
            <div className="leading-none">
              <p className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                Standard
              </p>
              <p className="mt-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                Dave&apos;s Plumbing Ltd
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className={cx(
              "inline-flex size-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-50",
              focusRing,
            )}
          >
            <RiCloseLine className="size-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="mobile navigation" className="flex flex-1 flex-col space-y-8">
          <ul role="list" className="space-y-1">
            {navigation.map((item) => (
              <li key={item.name}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={item.active ? "page" : undefined}
                  className={cx(
                    item.active
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                      : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-50",
                    "flex items-center gap-x-2.5 rounded-md px-2 py-2 text-sm font-medium transition",
                    focusRing,
                  )}
                >
                  <item.icon className="size-5 shrink-0" aria-hidden />
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
          <div>
            <span className="px-2 text-xs font-medium leading-6 text-gray-500">
              Shortcuts
            </span>
            <ul aria-label="shortcuts" role="list" className="mt-1 space-y-1">
              {shortcuts.map((item) => (
                <li key={item.name}>
                  <a
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cx(
                      "flex items-center gap-x-2.5 rounded-md px-2 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-50",
                      focusRing,
                    )}
                  >
                    <item.icon className="size-5 shrink-0 text-gray-400" aria-hidden />
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </>
  )
}
