"use client"

import * as React from "react"
import { RiSparkling2Line } from "@remixicon/react"

import { Badge } from "@/components/tremor/Badge"
import type { Verdict } from "@/lib/contracts/verdict"
import { CustomerDrawer } from "./CustomerDrawer"
import { HeadlineBanner } from "./HeadlineBanner"
import { KpiCards } from "./KpiCards"
import { MarginRankingChart } from "./MarginRankingChart"
import { ProfitMixDonut } from "./ProfitMixDonut"
import { RevenueCostChart } from "./RevenueCostChart"
import { VerdictList } from "./VerdictList"
import { money, rankWorstFirst } from "./format"

export function Dashboard({ verdict }: { verdict: Verdict }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const selected =
    verdict.customers.find((c) => c.customerId === selectedId) ?? null
  const worst = rankWorstFirst(verdict.customers)[0]

  const generated = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(verdict.generatedAt))

  return (
    <div className="w-full" id="top">
      {/* Page header — mirrors the Tremor overview page section header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 sm:text-xl dark:text-gray-50">
            Overview
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {verdict.tenantName} · verdict generated {generated}
          </p>
        </div>
        <Badge variant="success" className="w-fit gap-1.5 px-2.5 py-1">
          <RiSparkling2Line className="size-4" aria-hidden />
          {money(verdict.kpis.hiddenLossesUncovered, verdict.baseCurrency)} in
          hidden losses found
        </Badge>
      </div>

      <div className="mt-6 space-y-6 sm:mt-8">
        {/* The reveal — visual anchor near the top */}
        {worst?.isMoneyLoser && (
          <div id="reveal" className="scroll-mt-20">
            <HeadlineBanner customer={worst} onOpen={setSelectedId} />
          </div>
        )}

        {/* KPI row */}
        <KpiCards
          kpis={verdict.kpis}
          customers={verdict.customers}
          currency={verdict.baseCurrency}
        />

        {/* Chart cards — responsive grid, overview-page rhythm */}
        <div
          id="margins"
          className="grid scroll-mt-20 grid-cols-1 gap-6 lg:grid-cols-3"
        >
          <div className="lg:col-span-2">
            <MarginRankingChart
              customers={verdict.customers}
              currency={verdict.baseCurrency}
            />
          </div>
          <ProfitMixDonut
            customers={verdict.customers}
            currency={verdict.baseCurrency}
          />
        </div>

        <RevenueCostChart
          customers={verdict.customers}
          currency={verdict.baseCurrency}
        />

        {/* Ranked customer table */}
        <div id="customers" className="scroll-mt-20">
          <VerdictList
            customers={verdict.customers}
            currency={verdict.baseCurrency}
            onOpen={setSelectedId}
          />
        </div>
      </div>

      <CustomerDrawer customer={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}
