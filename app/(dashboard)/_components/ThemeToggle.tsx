"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons"
import { useTheme } from "next-themes"

import { cx } from "@/components/tremor/utils"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cx(
        "inline-flex size-9 items-center justify-center rounded-full border transition-colors",
        "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
        "dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10",
        "outline-brand-green focus-visible:outline-2",
      )}
    >
      {mounted && isDark ? (
        <HugeiconsIcon icon={Sun03Icon} className="size-4" aria-hidden />
      ) : (
        <HugeiconsIcon icon={Moon02Icon} className="size-4" aria-hidden />
      )}
    </button>
  )
}
