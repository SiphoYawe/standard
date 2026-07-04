import type { Metadata } from "next"
import { Red_Hat_Display } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "./theme-provider"

const redHatDisplay = Red_Hat_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-red-hat-display",
})

export const metadata: Metadata = {
  title: "Standard: the real margin on every customer",
  description:
    "Standard reveals the real margin on every customer, traces every number to its Xero source, and drafts the fix.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${redHatDisplay.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
