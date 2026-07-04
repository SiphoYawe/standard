import { getMockVerdict } from "@/lib/contracts/mock"
import { Dashboard } from "./_components/Dashboard"

export default function DashboardPage() {
  const verdict = getMockVerdict()
  return <Dashboard verdict={verdict} />
}
