import Image from "next/image"
import { ChevronsUpDown } from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"

import { cx, focusRing } from "@/components/tremor/utils"
import { MobileSidebar } from "./MobileSidebar"
import { ThemeToggle } from "./ThemeToggle"
import { navigation, shortcuts } from "./nav"

/** The org / workspace the verdict belongs to. */
const WORKSPACE = {
  name: "Dave's Plumbing Ltd",
  role: "Owner workspace",
  initials: "DP",
}

const OWNER = {
  name: "Dave Nolan",
  email: "dave@davesplumbing.co.uk",
  initials: "DN",
}

/** Standard logo lockup: light mark on light surfaces, all-green on dark teal. */
function BrandMark() {
  return (
    <div className="flex items-center px-1">
      <Image
        src="/brand/standard-light.svg"
        alt="Standard"
        width={148}
        height={33}
        priority
        unoptimized
        className="h-7 w-auto dark:hidden"
      />
      <Image
        src="/brand/standard-dark.svg"
        alt="Standard"
        width={148}
        height={33}
        priority
        unoptimized
        className="hidden h-7 w-auto dark:block"
      />
    </div>
  )
}

/** The workspace indicator, styled like the template's workspace switcher. */
function WorkspaceCard() {
  return (
    <div
      className={cx(
        "flex w-full items-center gap-x-2.5 rounded-md border border-gray-300 bg-white p-2 text-sm shadow-xs",
        "dark:border-white/10 dark:bg-white/5",
      )}
    >
      <span
        className="flex aspect-square size-8 items-center justify-center rounded bg-brand-green p-2 text-xs font-medium text-white"
        aria-hidden
      >
        {WORKSPACE.initials}
      </span>
      <div className="flex w-full items-center justify-between gap-x-3 truncate">
        <div className="truncate">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-50">
            {WORKSPACE.name}
          </p>
          <p className="truncate text-left text-xs text-gray-500 dark:text-gray-400">
            {WORKSPACE.role}
          </p>
        </div>
        <ChevronsUpDown
          className="size-5 shrink-0 text-gray-400"
          aria-hidden
        />
      </div>
    </div>
  )
}

function NavSection() {
  return (
    <nav
      aria-label="core navigation links"
      className="flex flex-1 flex-col space-y-8"
    >
      <ul role="list" className="space-y-0.5">
        {navigation.map((item) => (
          <li key={item.name}>
            <a
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cx(
                item.active
                  ? "bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-green"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-50",
                "flex items-center gap-x-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition",
                focusRing,
              )}
            >
              <HugeiconsIcon
                icon={item.icon}
                className="size-4 shrink-0"
                aria-hidden
              />
              {item.name}
            </a>
          </li>
        ))}
      </ul>
      <div>
        <span className="px-2 text-xs font-medium leading-6 text-gray-500 dark:text-gray-500">
          Shortcuts
        </span>
        <ul aria-label="shortcuts" role="list" className="mt-1 space-y-0.5">
          {shortcuts.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className={cx(
                  "flex items-center gap-x-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-50",
                  focusRing,
                )}
              >
                <HugeiconsIcon
                  icon={item.icon}
                  className="size-4 shrink-0 text-gray-400"
                  aria-hidden
                />
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

function OwnerRow() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md p-1.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-xs font-medium text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
          aria-hidden
        >
          {OWNER.initials}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-50">
            {OWNER.name}
          </span>
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {OWNER.email}
          </span>
        </span>
      </span>
      <ThemeToggle />
    </div>
  )
}

export function Sidebar() {
  return (
    <>
      {/* Desktop sidebar (lg+) */}
      <nav className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <aside className="flex grow flex-col gap-y-6 overflow-y-auto border-r border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-brand-dark">
          <BrandMark />
          <WorkspaceCard />
          <NavSection />
          <div className="mt-auto border-t border-gray-200 pt-3 dark:border-white/10">
            <OwnerRow />
          </div>
        </aside>
      </nav>

      {/* Mobile top navbar (below lg) */}
      <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white/90 px-4 backdrop-blur-md lg:hidden dark:border-white/10 dark:bg-brand-dark/90">
        <BrandMark />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <MobileSidebar />
        </div>
      </div>
    </>
  )
}
