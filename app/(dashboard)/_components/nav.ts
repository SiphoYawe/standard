import {
  CheckListIcon,
  Home01Icon,
  PieChartIcon,
  Settings02Icon,
  Target01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

export type NavItem = {
  name: string
  href: string
  icon: IconSvgElement
  /** Only the current page is active in this single-route demo. */
  active?: boolean
}

/** Primary navigation - mirrors the Tremor dashboard template's Sidebar. */
export const navigation: NavItem[] = [
  { name: "Overview", href: "#top", icon: Home01Icon, active: true },
  { name: "Customers", href: "#customers", icon: UserGroupIcon },
  { name: "Settings", href: "#settings", icon: Settings02Icon },
]

/** In-page shortcuts - the template's "Shortcuts" block, made functional. */
export const shortcuts: NavItem[] = [
  { name: "The money-loser", href: "#reveal", icon: Target01Icon },
  { name: "Margin ranking", href: "#margins", icon: PieChartIcon },
  { name: "Every customer", href: "#customers", icon: CheckListIcon },
]
