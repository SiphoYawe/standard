"use client"

import * as React from "react"
import {
  RiCheckLine,
  RiFileCopyLine,
  RiMailSendLine,
  RiRefreshLine,
} from "@remixicon/react"

import { Button } from "@/components/tremor/Button"
import { cx } from "@/components/tremor/utils"

export function DraftedFixPanel({
  draft,
  customerName,
}: {
  draft: string
  customerName: string
}) {
  const [text, setText] = React.useState(draft)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    setText(draft)
  }, [draft])

  const edited = text !== draft

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard may be blocked; selection still works
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
            <RiMailSendLine className="size-4" aria-hidden />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              Drafted fix — a repricing note to {customerName}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Editable, built from real numbers. Nothing is ever sent for you.
            </p>
          </div>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        spellCheck={false}
        aria-label={`Repricing email to ${customerName}`}
        className={cx(
          "mt-3 w-full resize-y rounded-lg border bg-white p-3 text-sm leading-relaxed text-gray-800 shadow-xs",
          "border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200",
          "dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-blue-900/40",
        )}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-h-4 text-xs text-gray-500 dark:text-gray-400">
          {edited && (
            <button
              type="button"
              onClick={() => setText(draft)}
              className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <RiRefreshLine className="size-3.5" aria-hidden />
              Reset to draft
            </button>
          )}
        </div>
        <Button
          type="button"
          onClick={copy}
          className={cx(
            "gap-1.5",
            copied &&
              "bg-emerald-600 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-600",
          )}
        >
          {copied ? (
            <>
              <RiCheckLine className="size-4" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <RiFileCopyLine className="size-4" aria-hidden />
              Copy email
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
