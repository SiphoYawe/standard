"use client"

import { BarChart } from "@/components/tremor/BarChart"
import { Card } from "@/components/tremor/Card"
import type { CustomerMargin } from "@/lib/contracts/verdict"
import { compactMoney, money, totalCost } from "./format"

function shortName(name: string): string {
  return name.split(/[\s&]+/)[0]
}

export function RevenueCostChart({
  customers,
  currency,
}: {
  customers: CustomerMargin[]
  currency: string
}) {
  const data = [...customers]
    .sort((a, b) => b.revenue - a.revenue)
    .map((c) => ({
      name: shortName(c.customerName),
      Revenue: c.revenue,
      "Attributed cost": totalCost(c),
    }))

  return (
    <Card>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">
        Revenue vs. attributed cost
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Where the cost bar catches the revenue bar, the margin is gone
      </p>
      <BarChart
        className="mt-6 h-72"
        data={data}
        index="name"
        categories={["Revenue", "Attributed cost"]}
        colors={["blue", "amber"]}
        valueFormatter={(v) => compactMoney(v, currency)}
        yAxisWidth={52}
        barCategoryGap="20%"
        customTooltip={({ active, payload, label }) => {
          if (!active || !payload?.length) return null
          return (
            <div className="rounded-md border border-gray-200 bg-white text-sm shadow-md dark:border-gray-800 dark:bg-gray-950">
              <div className="border-b border-inherit px-3 py-2 font-medium text-gray-900 dark:text-gray-50">
                {label}
              </div>
              <div className="space-y-1 px-3 py-2">
                {payload.map((p) => (
                  <div
                    key={p.category}
                    className="flex items-center justify-between gap-6"
                  >
                    <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                      <span
                        className={
                          p.category === "Revenue"
                            ? "size-2 rounded-xs bg-blue-500"
                            : "size-2 rounded-xs bg-amber-500"
                        }
                      />
                      {p.category}
                    </span>
                    <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                      {money(p.value, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        }}
      />
    </Card>
  )
}
