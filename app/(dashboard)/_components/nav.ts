import {
  RiFocus3Line,
  RiGroupLine,
  RiHome2Line,
  RiListCheck2,
  RiPieChart2Line,
  RiSettings3Line,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

export type NavItem = {
  name: string
  href: string
  icon: RemixiconComponentType
  /** Only the current page is active in this single-route demo. */
  active?: boolean
}

/** Primary navigation — mirrors the Tremor dashboard template's Sidebar. */
export const navigation: NavItem[] = [
  { name: "Overview", href: "#top", icon: RiHome2Line, active: true },
  { name: "Customers", href: "#customers", icon: RiGroupLine },
  { name: "Settings", href: "#settings", icon: RiSettings3Line },
]

/** In-page shortcuts — the template's "Shortcuts" block, made functional. */
export const shortcuts: NavItem[] = [
  { name: "The money-loser", href: "#reveal", icon: RiFocus3Line },
  { name: "Margin ranking", href: "#margins", icon: RiPieChart2Line },
  { name: "Every customer", href: "#customers", icon: RiListCheck2 },
]
