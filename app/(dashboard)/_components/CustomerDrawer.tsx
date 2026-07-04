"use client"

import * as React from "react"
import {
  RiCloseLine,
  RiEdit2Line,
  RiErrorWarningFill,
  RiPushpinLine,
} from "@remixicon/react"

import { Badge } from "@/components/tremor/Badge"
import { BarList } from "@/components/tremor/BarList"
import { cx } from "@/components/tremor/utils"
import type { Allocation, CustomerMargin } from "@/lib/contracts/verdict"
import { DraftedFixPanel } from "./DraftedFixPanel"
import {
  confidenceLabel,
  kindLabel,
  marginRate,
  money,
  percent,
  signedMoney,
  sourceTypeLabel,
  totalCost,
} from "./format"

export function CustomerDrawer({
  customer,
  onClose,
}: {
  customer: CustomerMargin | null
  onClose: () => void
}) {
  const open = customer !== null

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!customer) return null

  const conf = confidenceLabel(customer.confidence)
  const costBars = [
    { name: "Direct costs", value: customer.directCost },
    { name: "Shared overhead", value: customer.overheadCost },
    ...(customer.ownerTimeCost > 0
      ? [{ name: "Your time", value: customer.ownerTimeCost }]
      : []),
  ]

  return (
    <div className="fixed inset-0 z-50">
      {/* overlay */}
      <div
        className="animate-overlay-show absolute inset-0 bg-gray-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* panel — Tremor Drawer styling (floating, inset, rounded) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${customer.customerName} — cost trace`}
        className={cx(
          "animate-drawer-slide-left-and-fade absolute inset-y-2 right-2 flex w-[95vw] max-w-lg flex-col overflow-hidden rounded-md border shadow-lg max-sm:inset-x-2",
          "border-gray-200 bg-white dark:border-gray-900 dark:bg-[#090E1A]",
        )}
      >
        {/* header */}
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 p-5 dark:border-gray-800">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
                {customer.customerName}
              </h2>
              {customer.isMoneyLoser ? (
                <Badge variant="error">Losing money</Badge>
              ) : (
                <Badge variant="success">Profitable</Badge>
              )}
            </div>
            <p className="mt-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span>Overall confidence:</span>
              <Badge variant={conf.variant}>{conf.label}</Badge>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <RiCloseLine className="size-5" aria-hidden />
          </button>
        </header>

        {/* scroll body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* margin ledger */}
          <section className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <BreakdownRow
              label="Revenue invoiced"
              value={money(customer.revenue, customer.currency)}
            />
            <BreakdownRow
              label="Direct costs"
              value={`-${money(customer.directCost, customer.currency)}`}
              muted
            />
            <BreakdownRow
              label="Share of overhead"
              value={`-${money(customer.overheadCost, customer.currency)}`}
              muted
            />
            {customer.ownerTimeCost > 0 && (
              <BreakdownRow
                label="Your time (estimate)"
                value={`-${money(customer.ownerTimeCost, customer.currency)}`}
                muted
              />
            )}
            <div className="flex items-center justify-between bg-gray-50 px-4 py-3 dark:bg-gray-900/40">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                True margin
              </span>
              <span className="text-right">
                <span
                  className={cx(
                    "block text-lg font-semibold tabular-nums",
                    customer.trueMargin < 0
                      ? "text-red-600 dark:text-red-500"
                      : "text-emerald-600 dark:text-emerald-500",
                  )}
                >
                  {signedMoney(customer.trueMargin, customer.currency)}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {percent(marginRate(customer))} ·{" "}
                  {money(totalCost(customer), customer.currency)} total cost
                </span>
              </span>
            </div>
          </section>

          {/* why */}
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {customer.why}
          </p>

          {/* cost make-up (Tremor BarList) */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              Cost make-up
            </h3>
            <p className="mb-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
              What ate the invoice, biggest first.
            </p>
            <BarList
              data={costBars}
              valueFormatter={(v) => money(v, customer.currency)}
            />
          </section>

          {/* receipts */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                The receipts — every number traced to Xero
              </h3>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {customer.allocations.length} allocations
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              <b className="font-medium text-emerald-600 dark:text-emerald-500">
                Confident
              </b>{" "}
              = native Xero link ·{" "}
              <b className="font-medium text-blue-600 dark:text-blue-500">
                Fairly sure
              </b>{" "}
              = matched by description ·{" "}
              <b className="font-medium text-amber-600 dark:text-amber-500">
                Needs your check
              </b>{" "}
              = inferred
            </p>

            <div className="mt-3 space-y-3">
              {customer.allocations.map((a) => (
                <AllocationCard key={a.id} allocation={a} />
              ))}
            </div>
          </section>

          {/* drafted fix */}
          {customer.draftedFix && (
            <DraftedFixPanel
              draft={customer.draftedFix}
              customerName={customer.customerName}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function BreakdownRow({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-800/70">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={cx(
          "text-sm font-medium tabular-nums",
          muted
            ? "text-gray-600 dark:text-gray-300"
            : "text-gray-900 dark:text-gray-50",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function AllocationCard({ allocation }: { allocation: Allocation }) {
  const conf = confidenceLabel(allocation.confidence)
  const kindVariant = allocation.kind === "direct" ? "default" : "neutral"

  return (
    <div
      className={cx(
        "rounded-xl border p-4",
        conf.flagged
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-800/70 dark:bg-amber-950/20"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={kindVariant}>{kindLabel(allocation.kind)}</Badge>
            <Badge variant={conf.variant}>{conf.label}</Badge>
            {conf.flagged && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500">
                <RiErrorWarningFill className="size-3.5" aria-hidden />
                Flag for review
              </span>
            )}
          </div>
          {allocation.driver && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Allocated by{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {allocation.driver}
              </span>
            </p>
          )}
          {allocation.rationale && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {allocation.rationale}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right text-base font-semibold tabular-nums text-gray-900 dark:text-gray-50">
          {money(allocation.amount, allocation.currency)}
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Traced to Xero
        </p>
        {allocation.sources.map((s, i) => (
          <div
            key={`${s.xeroId}-${i}`}
            className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  {sourceTypeLabel(s.type)}
                </span>
                <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {s.xeroId}
                </code>
                {s.editable ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    <RiEdit2Line className="size-3" aria-hidden />
                    Re-taggable
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                    <RiPushpinLine className="size-3" aria-hidden />
                    Locked
                  </span>
                )}
              </div>
              {s.description && (
                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                  {s.description}
                  {s.lineItemId ? ` · line ${s.lineItemId}` : ""}
                </p>
              )}
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums text-gray-700 dark:text-gray-200">
              {money(s.amount, allocation.currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
