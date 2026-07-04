import { Card } from "@/components/tremor/Card"
import { cx } from "@/components/tremor/utils"
import type { CustomerMargin } from "@/lib/contracts/verdict"
import { rankWorstFirst, signedMoney } from "./format"

export function MarginRankingChart({
  customers,
  currency,
}: {
  customers: CustomerMargin[]
  currency: string
}) {
  const ranked = rankWorstFirst(customers)
  const maxAbs = Math.max(...ranked.map((c) => Math.abs(c.trueMargin)), 1)

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">
            Margin ranking
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            True margin per customer, worst first
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <Legend className="bg-red-500" label="Losing" />
          <Legend className="bg-emerald-500" label="Profit" />
        </div>
      </div>

      <div className="mt-5 flex flex-1 flex-col justify-center gap-2.5">
        {ranked.map((c) => {
          const ratio = Math.abs(c.trueMargin) / maxAbs
          const negative = c.trueMargin < 0
          return (
            <div key={c.customerId} className="flex items-center gap-3">
              <div className="w-20 shrink-0 truncate text-sm font-medium text-gray-700 sm:w-28 dark:text-gray-300">
                {c.customerName}
              </div>
              <div className="relative h-7 flex-1 rounded bg-gray-50 dark:bg-gray-900/50">
                <div
                  className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-gray-700"
                  aria-hidden
                />
                <div
                  className={cx(
                    "absolute inset-y-1 rounded transition-[width] duration-700 ease-out",
                    negative
                      ? "right-1/2 bg-red-500 dark:bg-red-500/90"
                      : "left-1/2 bg-emerald-500 dark:bg-emerald-500/90",
                  )}
                  style={{ width: `${ratio * 50}%` }}
                />
              </div>
              <div
                className={cx(
                  "w-20 shrink-0 text-right text-sm font-semibold tabular-nums",
                  negative
                    ? "text-red-600 dark:text-red-500"
                    : "text-emerald-600 dark:text-emerald-500",
                )}
              >
                {signedMoney(c.trueMargin, currency)}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("size-2.5 rounded-sm", className)} aria-hidden />
      {label}
    </span>
  )
}
