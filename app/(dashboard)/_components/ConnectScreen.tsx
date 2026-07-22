import Image from "next/image"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, SecurityLockIcon } from "@hugeicons/core-free-icons"

import { cx, focusRing } from "@/components/tremor/utils"

/**
 * Connect-first onboarding. Shown whenever there is no real Verdict yet (no Xero
 * organisation connected). No sidebar, no mock figures - just the Standard mark,
 * what the product does, and the single action that starts the OAuth flow.
 *
 * The CTA is a plain anchor to `/api/connect` (the server route that mints the
 * CSRF state and 302s to the Xero consent screen), so this stays a server
 * component with zero client JS.
 */
export function ConnectScreen() {
  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-gray-50 px-6 py-16 dark:bg-ink">
      {/* Subtle on-palette glow behind the content (brand green, very low alpha). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, rgba(8,160,69,0.12), transparent 72%)",
        }}
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        {/* Standard logo: light mark on light surface, all-green mark on dark teal. */}
        <div className="flex items-center">
          <Image
            src="/brand/standard-light.svg"
            alt="Standard"
            width={168}
            height={37}
            priority
            unoptimized
            className="h-9 w-auto dark:hidden"
          />
          <Image
            src="/brand/standard-dark.svg"
            alt="Standard"
            width={168}
            height={37}
            priority
            unoptimized
            className="hidden h-9 w-auto dark:block"
          />
        </div>

        <span className="mt-9 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-brand-mid shadow-xs dark:border-white/10 dark:bg-white/5 dark:text-brand-green">
          <span
            className="size-1.5 rounded-full bg-brand-green"
            aria-hidden
          />
          Connect to begin
        </span>

        <h1 className="mt-5 text-balance text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-50">
          See the real margin on every customer
        </h1>

        <p className="mt-4 text-pretty text-base leading-relaxed text-gray-600 dark:text-gray-300">
          Standard reveals the real margin on every customer from your existing
          Xero books, traces every figure back to its source, and drafts the
          fix. Connect your organisation to see yours.
        </p>

        <a
          href="/api/connect"
          className={cx(
            "mt-9 inline-flex items-center justify-center gap-2 rounded-md border border-transparent bg-brand-green px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors duration-100 hover:bg-brand-green/90",
            focusRing,
          )}
        >
          Connect your Xero organisation
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-4 shrink-0"
            aria-hidden
          />
        </a>

        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <HugeiconsIcon
            icon={SecurityLockIcon}
            className="size-3.5 shrink-0"
            aria-hidden
          />
          Read-only to start. Your data stays in Xero.
        </p>
      </div>

      <p className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-xs text-gray-400 dark:text-gray-500">
        Built by{" "}
        <a
          href="https://siphoyawe.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition-colors hover:text-brand-green"
        >
          Sipho Yawe
        </a>
      </p>
    </main>
  )
}
