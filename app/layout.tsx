import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { TopNav } from "@/components/TopNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Kindred",
  description: "Your agent finds the people you'd genuinely click with.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen overflow-x-hidden font-sans">
        <Providers>
          <TopNav />
          <main className="mx-auto w-full max-w-[1320px] px-4 pb-10 pt-4 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
