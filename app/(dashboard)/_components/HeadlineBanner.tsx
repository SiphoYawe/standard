import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/tremor/Button"
import { Card } from "@/components/tremor/Card"
import { cx } from "@/components/tremor/utils"
import type { CustomerMargin } from "@/lib/contracts/verdict"
import { money, totalCost } from "./format"

export function HeadlineBanner({
  customer,
  onOpen,
}: {
  customer: CustomerMargin
  onOpen: (customerId: string) => void
}) {
  const loss = Math.abs(customer.trueMargin)

  return (
    <Card
      className={cx(
        "animate-rise relative overflow-hidden p-6 text-white sm:p-8",
        "border-brand-green/25 bg-brand-dark shadow-lg shadow-brand-dark/20",
        "ring-1 ring-inset ring-brand-green/20 dark:ring-brand-green/40",
      )}
    >
      {/* soft brand glow, purely decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-green/15 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-2.5 py-1 text-xs font-semibold text-white">
            <HugeiconsIcon icon={AlertCircleIcon} className="size-3.5" aria-hidden />
            The verdict
          </span>

          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {customer.customerName} is quietly costing you{" "}
            <span className="whitespace-nowrap underline decoration-brand-green decoration-4 underline-offset-4">
              {money(loss, customer.currency)}
            </span>{" "}
            a year.
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-white/75 sm:text-base">
            {customer.why}
          </p>

          <Button
            variant="primary"
            onClick={() => onOpen(customer.customerId)}
            className="group mt-5 gap-2"
          >
            See the receipts
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Button>
        </div>

        {/* the number moment */}
        <div className="grid shrink-0 grid-cols-3 gap-px overflow-hidden rounded-xl bg-white/15 text-center ring-1 ring-inset ring-white/15 lg:w-[420px]">
          <Stat
            label="Invoiced"
            value={money(customer.revenue, customer.currency)}
          />
          <Stat
            label="True cost"
            value={money(totalCost(customer), customer.currency)}
          />
          <Stat
            label="True margin"
            value={`-${money(loss, customer.currency)}`}
            tone="loss"
          />
        </div>
      </div>
    </Card>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "loss"
}) {
  return (
    <div
      className={cx(
        "px-4 py-4",
        tone === "loss" ? "bg-white/10" : "bg-white/[0.04]",
      )}
    >
      <p className="text-xs font-medium text-white/60">{label}</p>
      <p
        className={cx(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "loss" ? "text-white" : "text-white/90",
        )}
      >
        {value}
      </p>
    </div>
  )
}
