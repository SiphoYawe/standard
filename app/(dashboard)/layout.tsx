// Thin container. The connect-first screen renders full-bleed (no sidebar) and
// the dashboard renders its own Sidebar + main shell, so the shell is chosen in
// page.tsx per verdict state rather than forced on every child here.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
