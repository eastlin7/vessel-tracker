import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strait of Hormuz Tracker",
  description: "Ship tracking through the Strait of Hormuz",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
