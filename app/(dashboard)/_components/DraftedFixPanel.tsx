"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Copy01Icon,
  MailSend01Icon,
  RefreshIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons"

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
    <div className="rounded-xl border border-brand-green/25 bg-brand-green/5 p-4 dark:border-brand-green/25 dark:bg-brand-green/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-green/15 text-brand-green dark:bg-brand-green/20 dark:text-brand-green">
            <HugeiconsIcon icon={MailSend01Icon} className="size-4" aria-hidden />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              Drafted fix: a repricing note to {customerName}
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
          "border-gray-200 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25",
          "dark:border-white/10 dark:bg-ink dark:text-gray-100 dark:focus:ring-brand-green/35",
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
              <HugeiconsIcon icon={RefreshIcon} className="size-3.5" aria-hidden />
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
              "bg-brand-green hover:bg-brand-green dark:bg-brand-green dark:hover:bg-brand-green",
          )}
        >
          {copied ? (
            <>
              <HugeiconsIcon icon={Tick01Icon} className="size-4" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <HugeiconsIcon icon={Copy01Icon} className="size-4" aria-hidden />
              Copy email
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
