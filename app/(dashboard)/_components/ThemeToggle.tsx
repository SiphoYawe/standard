"use client"

import * as React from "react"
import { RiMoonClearLine, RiSunLine } from "@remixicon/react"
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
        "dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800",
        "outline-blue-500 focus-visible:outline-2",
      )}
    >
      {mounted && isDark ? (
        <RiSunLine className="size-4" aria-hidden />
      ) : (
        <RiMoonClearLine className="size-4" aria-hidden />
      )}
    </button>
  )
}
