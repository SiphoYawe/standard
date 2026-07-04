import { Sidebar } from "./_components/Sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto min-h-full max-w-screen-2xl bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <main className="lg:pl-72">
        <div className="p-4 sm:px-6 sm:py-8 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  )
}
