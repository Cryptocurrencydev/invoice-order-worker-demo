import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb" });

export const metadata: Metadata = {
  title: "Invoice → Order worker · demo",
  description: "A reliable AI worker that turns supplier invoices into verified customer orders: structured extraction, deterministic validation, tool calls and read-back verification.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f4ef" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans antialiased flex flex-col">
        <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-semibold min-w-0">
              <span aria-hidden className="grid place-items-center size-7 rounded-md bg-accent text-white text-[13px] font-bold shrink-0">H&amp;P</span>
              <span className="truncate">Harbor &amp; Pine <span className="text-muted font-normal hidden sm:inline">· invoice → order worker</span></span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link href="/" className="px-2.5 py-2 rounded-md hover:bg-black/5">Inbox</Link>
              <Link href="/review" className="px-2.5 py-2 rounded-md hover:bg-black/5">Office</Link>
              <Link href="/eval" className="px-2.5 py-2 rounded-md hover:bg-black/5 font-semibold text-accent">Eval</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1 w-full mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="border-t border-line text-sm text-muted">
          <div className="mx-auto max-w-6xl px-4 py-5 flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
            <span>
              Demo by{" "}
              <a href="https://dctechltd.com" target="_blank" rel="noopener" className="font-semibold text-ink underline underline-offset-2 hover:text-accent">
                DC Tech
              </a>
            </span>
            <span className="text-faint">Fictional dealer, suppliers, products and invoices. No real manufacturer data.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
