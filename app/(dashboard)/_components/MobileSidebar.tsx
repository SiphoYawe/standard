"use client"

import * as React from "react"
import Image from "next/image"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons"

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
          "inline-flex size-9 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5",
          focusRing,
        )}
      >
        <HugeiconsIcon icon={Menu01Icon} className="size-5" aria-hidden />
      </button>

      {/* Overlay */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cx(
          "fixed inset-0 z-50 bg-brand-dark/50 backdrop-blur-[1px] transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-y-6 border-r border-gray-200 bg-white p-4 shadow-xl transition-transform duration-300 ease-out lg:hidden dark:border-white/10 dark:bg-brand-dark",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center px-1">
            <Image
              src="/brand/standard-light.svg"
              alt="Standard"
              width={148}
              height={33}
              unoptimized
              className="h-7 w-auto dark:hidden"
            />
            <Image
              src="/brand/standard-dark.svg"
              alt="Standard"
              width={148}
              height={33}
              unoptimized
              className="hidden h-7 w-auto dark:block"
            />
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className={cx(
              "inline-flex size-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/5 dark:hover:text-gray-50",
              focusRing,
            )}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-5" aria-hidden />
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
                      ? "bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-green"
                      : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-50",
                    "flex items-center gap-x-2.5 rounded-md px-2 py-2 text-sm font-medium transition",
                    focusRing,
                  )}
                >
                  <HugeiconsIcon
                    icon={item.icon}
                    className="size-5 shrink-0"
                    aria-hidden
                  />
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
                      "flex items-center gap-x-2.5 rounded-md px-2 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-50",
                      focusRing,
                    )}
                  >
                    <HugeiconsIcon
                      icon={item.icon}
                      className="size-5 shrink-0 text-gray-400"
                      aria-hidden
                    />
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
