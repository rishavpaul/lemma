import type { Metadata } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

const ui = Schibsted_Grotesk({ variable: "--font-ui", subsets: ["latin"] });
const num = JetBrains_Mono({ variable: "--font-num", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Design Coach",
  description: "Daily staff-level system design practice: talk it through, draw it, get graded.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${ui.variable} ${num.variable} h-full`}>
      <body className="h-full">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <TooltipProvider delay={200}>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
