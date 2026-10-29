import type { Metadata, Viewport } from "next";
import { Doto, Funnel_Display, Funnel_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Funnel_Display({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-display" });
const sans = Funnel_Sans({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-sans" });
const dots = Doto({ subsets: ["latin"], weight: ["700"], variable: "--font-dots" });

export const metadata: Metadata = {
  title: "Proviso — agent payments that wait for the work",
  description:
    "Conditional agent-to-agent settlement on HSP. The HSP payment lands in an escrow whose address is the deal's terms; it releases on delivery, refunds on a no-show, and splits on a 2-of-3 validator ruling.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0a0a0b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${dots.variable}`}>
      <body>
        <div className="grid-bg" aria-hidden />
        <div className="grain" aria-hidden />
        <nav className="nav">
          <Link className="mark" href="/">
            <i />
            Proviso
          </Link>
          <ul>
            <li className="opt"><Link href="/#how">How it works</Link></li>
            <li className="opt"><Link href="/deals">Deals</Link></li>
            <li className="opt"><Link href="/agents">Agents</Link></li>
            <li className="opt"><Link href="/builders">Builders</Link></li>
            <li className="opt"><Link href="/proof">Proof</Link></li>
            <li><Link href="/run" className="btn ghost" style={{ padding: "8px 14px", fontSize: 14 }}>Run a deal</Link></li>
          </ul>
        </nav>
        {children}
        <footer className="foot">
          <span>Proviso · conditional settlement for agent payments on HSP · HSK Chain</span>
          <span style={{ display: "flex", gap: 20 }}>
            <a href="https://github.com/RaYYeR220/proviso">Source</a>
            <Link href="/proof">Contracts</Link>
            <Link href="/builders">SDK &amp; MCP</Link>
          </span>
        </footer>
      </body>
    </html>
  );
}
