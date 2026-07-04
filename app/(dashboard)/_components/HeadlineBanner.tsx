import { RiAlarmWarningFill, RiArrowRightLine } from "@remixicon/react"

import { Badge } from "@/components/tremor/Badge"
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
        "animate-rise overflow-hidden p-6 sm:p-8",
        "border-red-200/80 bg-red-50/40 ring-1 ring-inset ring-red-100/70",
        "dark:border-red-900/50 dark:bg-red-950/20 dark:ring-red-900/30",
      )}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <Badge variant="error" className="gap-1.5">
            <RiAlarmWarningFill className="size-3.5" aria-hidden />
            The verdict
          </Badge>

          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-gray-50">
            {customer.customerName} is quietly costing you{" "}
            <span className="text-red-600 dark:text-red-500">
              {money(loss, customer.currency)}
            </span>{" "}
            a year.
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-gray-600 sm:text-base dark:text-gray-300">
            {customer.why}
          </p>

          <Button
            variant="destructive"
            onClick={() => onOpen(customer.customerId)}
            className="group mt-5 gap-2"
          >
            See the receipts
            <RiArrowRightLine
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Button>
        </div>

        {/* the number moment */}
        <div className="grid shrink-0 grid-cols-3 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 text-center lg:w-[420px] dark:border-gray-800 dark:bg-gray-800">
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
    <div className="bg-white px-4 py-4 dark:bg-[#090E1A]">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={cx(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "loss"
            ? "text-red-600 dark:text-red-500"
            : "text-gray-900 dark:text-gray-50",
        )}
      >
        {value}
      </p>
    </div>
  )
}
