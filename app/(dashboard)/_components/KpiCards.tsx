import { Badge } from "@/components/tremor/Badge"
import { Card } from "@/components/tremor/Card"
import { Divider } from "@/components/tremor/Divider"
import { cx } from "@/components/tremor/utils"
import type { CustomerMargin, VerdictKpis } from "@/lib/contracts/verdict"
import { money } from "./format"

type BadgeVariant = "default" | "neutral" | "success" | "error" | "warning"

type Kpi = {
  label: string
  value: React.ReactNode
  badge: string
  badgeVariant: BadgeVariant
  /** Subtle context line below the divider. */
  context: React.ReactNode
}

function KpiCard({ kpi, delay }: { kpi: Kpi; delay: number }) {
  return (
    <Card
      className="animate-rise flex flex-col p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {kpi.label}
        </dt>
        <Badge variant={kpi.badgeVariant}>{kpi.badge}</Badge>
      </div>
      <dd className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-gray-900 dark:text-gray-50">
        {kpi.value}
      </dd>
      <Divider className="my-4" />
      <p className="mt-auto text-sm text-gray-500 dark:text-gray-400">
        {kpi.context}
      </p>
    </Card>
  )
}

export function KpiCards({
  kpis,
  customers,
  currency,
}: {
  kpis: VerdictKpis
  customers: CustomerMargin[]
  currency: string
}) {
  const losers = customers.filter((c) => c.isMoneyLoser)
  const loserNames = losers.map((c) => c.customerName).join(" · ")

  const data: Kpi[] = [
    {
      label: "Hidden losses uncovered",
      value: money(kpis.hiddenLossesUncovered, currency),
      badge: "Reclaimable",
      badgeVariant: "success",
      context: (
        <>
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {loserNames || "No losses found"}
          </span>{" "}
          were quietly draining margin.
        </>
      ),
    },
    {
      label: "Money-losers",
      value: (
        <span className="tabular-nums">
          {kpis.moneyLoserCount}
          <span className="ml-1 text-lg font-medium text-gray-400 dark:text-gray-500">
            of {customers.length}
          </span>
        </span>
      ),
      badge: "Costing you",
      badgeVariant: "error",
      context: "Accounts costing more than they pay in.",
    },
    {
      label: "Blended true margin",
      value: money(kpis.blendedStandard, currency),
      badge: "Net",
      badgeVariant: "neutral",
      context: "Across every customer, after real cost and overhead.",
    },
    {
      label: "Revenue at risk",
      value: money(kpis.revenueAtRisk, currency),
      badge: "Watch",
      badgeVariant: "warning",
      context: "Invoiced through loss-making accounts.",
    },
  ]

  return (
    <dl
      aria-label="Key metrics"
      className={cx("grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4")}
    >
      {data.map((kpi, i) => (
        <KpiCard key={kpi.label} kpi={kpi} delay={i * 60} />
      ))}
    </dl>
  )
}
