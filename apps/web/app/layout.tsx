import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pod Stud",
  description: "Studio d'enregistrement de podcast à distance",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Pod Stud
          </Link>
          <nav>
            <Link href="/test-equipement">Tester mon équipement</Link>{" "}
            <Link href="/enregistrement">Enregistrer</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="foot">
          Version <span data-testid="app-version">{process.env.NEXT_PUBLIC_APP_VERSION}</span>
        </footer>
      </body>
    </html>
  );
}
