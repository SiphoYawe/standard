"use client"

import { RiArrowRightSLine, RiErrorWarningLine } from "@remixicon/react"

import { Badge } from "@/components/tremor/Badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
} from "@/components/tremor/Table"
import { cx } from "@/components/tremor/utils"
import type { CustomerMargin } from "@/lib/contracts/verdict"
import {
  confidenceLabel,
  marginRate,
  money,
  percent,
  rankWorstFirst,
  signedMoney,
} from "./format"

export function VerdictList({
  customers,
  currency,
  onOpen,
}: {
  customers: CustomerMargin[]
  currency: string
  onOpen: (customerId: string) => void
}) {
  const ranked = rankWorstFirst(customers)

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-xs dark:border-gray-900 dark:bg-[#090E1A]">
      <div className="flex flex-col gap-1 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">
            Every customer, worst first
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Ranked by true margin. Open a row to trace every number to Xero.
          </p>
        </div>
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
          {ranked.length} customers
        </span>
      </div>

      <TableRoot>
        <Table>
          <TableHead>
            <TableRow className="border-b border-gray-200 dark:border-gray-800">
              <TableHeaderCell className="w-10 text-center">#</TableHeaderCell>
              <TableHeaderCell>Customer</TableHeaderCell>
              <TableHeaderCell className="text-right">Revenue</TableHeaderCell>
              <TableHeaderCell className="text-right">Margin %</TableHeaderCell>
              <TableHeaderCell className="text-right">
                True margin
              </TableHeaderCell>
              <TableHeaderCell className="w-10" />
            </TableRow>
          </TableHead>
          <TableBody>
            {ranked.map((c, i) => {
              const conf = confidenceLabel(c.confidence)
              const rate = marginRate(c)
              const negative = c.trueMargin < 0
              const open = () => onOpen(c.customerId)
              return (
                <TableRow
                  key={c.customerId}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${c.customerName}`}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      open()
                    }
                  }}
                  className={cx(
                    "group cursor-pointer transition-colors",
                    "hover:bg-gray-50 dark:hover:bg-gray-900/50",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500",
                  )}
                >
                  {/* rank + status accent */}
                  <TableCell className="text-center">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={cx(
                          "h-8 w-1 rounded-full",
                          negative ? "bg-red-500" : "bg-emerald-500",
                        )}
                        aria-hidden
                      />
                      <span className="text-sm font-semibold tabular-nums text-gray-400 dark:text-gray-500">
                        {i + 1}
                      </span>
                    </span>
                  </TableCell>

                  {/* name + verdict */}
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-50">
                        {c.customerName}
                      </span>
                      {c.isMoneyLoser ? (
                        <Badge variant="error">Losing money</Badge>
                      ) : (
                        <Badge variant="success">Profitable</Badge>
                      )}
                      <Badge variant={conf.variant}>{conf.label}</Badge>
                      {c.lowConfidenceCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500">
                          <RiErrorWarningLine className="size-3.5" aria-hidden />
                          {c.lowConfidenceCount} to check
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-1 max-w-xl text-xs text-gray-500 dark:text-gray-400">
                      {c.why}
                    </p>
                  </TableCell>

                  <TableCell className="text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {money(c.revenue, currency)}
                  </TableCell>

                  <TableCell
                    className={cx(
                      "text-right tabular-nums",
                      negative
                        ? "text-red-600 dark:text-red-500"
                        : "text-gray-700 dark:text-gray-300",
                    )}
                  >
                    {percent(rate)}
                  </TableCell>

                  <TableCell
                    className={cx(
                      "text-right text-sm font-semibold tabular-nums",
                      negative
                        ? "text-red-600 dark:text-red-500"
                        : "text-emerald-600 dark:text-emerald-500",
                    )}
                  >
                    {signedMoney(c.trueMargin, currency)}
                  </TableCell>

                  <TableCell className="text-right">
                    <RiArrowRightSLine
                      className="size-5 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500 dark:text-gray-600"
                      aria-hidden
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
    </section>
  )
}
