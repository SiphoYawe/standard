import type {
  AllocationKind,
  Confidence,
  CustomerMargin,
} from "@/lib/contracts/verdict"

/** Whole-pound currency, e.g. £3,200 / -£3,200. */
export function money(amount: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Signed currency, e.g. +£7,600 / -£3,200 (0 always plain). */
export function signedMoney(amount: number, currency = "GBP"): string {
  const formatted = money(Math.abs(amount), currency)
  if (amount > 0) return `+${formatted}`
  if (amount < 0) return `-${formatted}`
  return formatted
}

/** Compact currency for chart axes, e.g. £12k. */
export function compactMoney(amount: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount)
}

export function percent(fraction: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(fraction)
}

/** Every attributed cost against this customer (direct + overhead + owner time). */
export function totalCost(c: CustomerMargin): number {
  return c.directCost + c.overheadCost + c.ownerTimeCost
}

export function marginRate(c: CustomerMargin): number {
  return c.revenue === 0 ? 0 : c.trueMargin / c.revenue
}

type BadgeVariant = "default" | "neutral" | "success" | "error" | "warning"

/** UX-DR6: confidence shown in plain language, never a raw score. */
export function confidenceLabel(confidence: Confidence): {
  label: string
  variant: BadgeVariant
  flagged: boolean
} {
  switch (confidence) {
    case "High":
      return { label: "Confident", variant: "success", flagged: false }
    case "Medium":
      return { label: "Fairly sure", variant: "default", flagged: false }
    case "Low":
      return { label: "Needs your check", variant: "warning", flagged: true }
  }
}

export function kindLabel(kind: AllocationKind): string {
  switch (kind) {
    case "direct":
      return "Direct cost"
    case "overhead":
      return "Shared overhead"
    case "owner_time":
      return "Your time"
  }
}

/** Human label for a Xero source type. */
export function sourceTypeLabel(type: string): string {
  switch (type) {
    case "LinkedTransaction":
      return "Linked transaction"
    case "BankTransaction":
      return "Bank transaction"
    case "Invoice":
      return "Bill / invoice"
    case "Report":
      return "P&L report"
    default:
      return type
  }
}

/** Customers ranked worst-first (money-losers lead), defensive against fixture order. */
export function rankWorstFirst(customers: CustomerMargin[]): CustomerMargin[] {
  return [...customers].sort((a, b) => a.trueMargin - b.trueMargin)
}
