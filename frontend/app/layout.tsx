import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cognoscere",
  description: "Aplikacja wspierająca psychoterapię przez ustrukturyzowany dialog między sesjami",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
