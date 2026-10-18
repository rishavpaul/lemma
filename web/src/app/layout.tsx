import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, JetBrains_Mono, STIX_Two_Text } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/shell/app-shell";
import { AuthGate } from "@/components/shell/auth-gate";
import "./globals.css";

// Two faces: STIX Two Text (the typeface of mathematical journals) for headlines, statements and reading,
// Schibsted Grotesk for the interface. JetBrains Mono is only for real code.
const text = STIX_Two_Text({ variable: "--font-text", subsets: ["latin"], style: ["normal", "italic"] });
const ui = Schibsted_Grotesk({ variable: "--font-ui", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lemma",
  description: "Daily staff-level interview practice: design a system out loud, solve coding problems, get graded.",
  manifest: "/manifest.webmanifest",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Lemma", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f5f1" }, { media: "(prefers-color-scheme: dark)", color: "#151513" }],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${text.variable} ${ui.variable} ${code.variable} h-full`}>
      <body className="h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider delay={200}>
            <AuthGate><AppShell>{children}</AppShell></AuthGate>
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
