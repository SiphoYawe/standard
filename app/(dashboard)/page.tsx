import { resolveVerdict } from "@/app/api/_lib/verdict-source"
import { ConnectScreen } from "./_components/ConnectScreen"
import { Dashboard } from "./_components/Dashboard"
import { Sidebar } from "./_components/Sidebar"

// Read the latest stored Verdict at request time (real-only). When no Xero
// organisation is connected there is no stored verdict, so resolveVerdict
// returns null and we render the connect-first screen. Once a live verdict
// exists we render the dashboard shell with real Xero data and the real
// organisation name (AD-4, AD-8 - the browser only ever sees the Verdict,
// never Xero).
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const { data: verdict } = await resolveVerdict()

  if (!verdict) {
    return <ConnectScreen />
  }

  return (
    <div className="mx-auto min-h-full max-w-screen-2xl bg-gray-50 dark:bg-ink">
      <Sidebar tenantName={verdict.tenantName} />
      <main className="lg:pl-72">
        <div className="p-4 sm:px-6 sm:py-8 lg:px-10 lg:py-8">
          <Dashboard verdict={verdict} />
        </div>
      </main>
    </div>
  )
}
