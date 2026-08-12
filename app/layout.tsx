import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twogether | Game night for two",
  description: "A cozy, pressure-free party game for two.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
