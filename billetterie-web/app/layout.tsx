import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Passage — Billetterie des collectifs",
  description: "Vos événements, vos billets et vos entrées, dans un même espace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
