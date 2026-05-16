import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LandMath - Enter an address. Get the math.",
  description:
    "Real estate investment analysis tool. Evaluate properties across multiple strategies: Fresh Build, Split & Build, Main + ADU, Flip & Fix.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#16a34a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white dark:bg-slate-900">
        {children}
      </body>
    </html>
  );
}
