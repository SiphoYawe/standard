import { getMockVerdict } from "@/lib/contracts/mock"
import { resolveVerdict } from "@/app/api/_lib/verdict-source"
import { Dashboard } from "./_components/Dashboard"

// Read the latest stored Verdict at request time. When Supabase isn't wired (or
// NEXT_PUBLIC_USE_MOCK_VERDICT is set), resolveVerdict returns the validated
// mock, so the dashboard is demoable with zero backend; once a live verdict
// exists it shows real Xero data (AD-4, AD-8 — the browser still only ever sees
// the Verdict, never Xero).
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const { data } = await resolveVerdict()
  const verdict = data ?? getMockVerdict()
  return <Dashboard verdict={verdict} />
}
