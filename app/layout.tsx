import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GFS Reporting",
  description: "Interní reporting projektů, přepadů a termínů GFS Visionary.",
  icons: {
    icon: [
      { url: "/visionary-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/visionary-favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/visionary-favicon.ico",
    apple: "/visionary-apple-touch.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
