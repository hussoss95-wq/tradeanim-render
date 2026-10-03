import type { Metadata, Viewport } from "next";
import { APP_NAME, APP_URL } from "@/lib/config";
import "./globals.css";

const description = "Motion-design studio for trading, Smart Money Concepts and ICT videos — animate candles, structure, liquidity and entries, then export MP4.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description,
  applicationName: APP_NAME,
  icons: { icon: "/favicon.svg" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description,
    url: "/",
  },
  twitter: { card: "summary", title: APP_NAME, description },
  // the editor is an app, not content: keep it out of search indexes
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0e14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
