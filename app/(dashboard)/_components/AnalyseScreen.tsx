"use client"

import * as React from "react"
import Image from "next/image"

import { cx, focusRing } from "@/components/tremor/utils"

/**
 * Shown when a Xero organisation is connected but no verdict has been computed
 * yet (a fresh connect, or after a disconnect). It runs the pipeline once on
 * mount (ingest, attribute, store), then reloads to render the dashboard. This
 * closes the gap where connecting appeared to do nothing.
 */
export function AnalyseScreen() {
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const res = await fetch("/api/pipeline", { method: "POST" })
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } | null }
          | null
        if (!res.ok) {
          if (!cancelled) setError(body?.error?.message ?? "Analysis failed.")
          return
        }
        if (!cancelled) window.location.href = "/"
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Analysis failed.")
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-white px-6 text-center dark:bg-ink">
      <Image
        src="/brand/standard-light.svg"
        alt="Standard"
        width={176}
        height={40}
        priority
        unoptimized
        className="h-9 w-auto dark:hidden"
      />
      <Image
        src="/brand/standard-dark.svg"
        alt="Standard"
        width={176}
        height={40}
        priority
        unoptimized
        className="hidden h-9 w-auto dark:block"
      />

      {error ? (
        <div className="flex max-w-md flex-col items-center gap-4">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
            Analysis did not finish
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={cx(
                "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-mid",
                focusRing,
              )}
            >
              Try again
            </button>
            <a
              href="/api/connect"
              className={cx(
                "rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5",
                focusRing,
              )}
            >
              Reconnect
            </a>
          </div>
        </div>
      ) : (
        <div className="flex max-w-md flex-col items-center gap-5">
          <span
            className="size-10 animate-spin rounded-full border-4 border-brand-green/25 border-t-brand-green"
            aria-hidden
          />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
            Analysing your Xero data
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Reading your ledger and computing the real margin on every customer.
            This takes a few seconds.
          </p>
        </div>
      )}
    </div>
  )
}
