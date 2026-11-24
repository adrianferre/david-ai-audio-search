import type { Metadata } from "next";
import { Besley, Geist_Mono, Inter } from "next/font/google";

import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The type of withdavid.ai: Inter for the interface, Besley for titles.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const besley = Besley({
  variable: "--font-besley",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Audio Search · David AI",
  description: "Search the audio catalog by what is said or what it sounds like.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${besley.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          // Light only for now; the toggle in theme-toggle.tsx is unused.
          forcedTheme="light"
          disableTransitionOnChange
        >
          <QueryProvider>
            {/* Shared so moving between tooltips opens the next one at once. */}
            <TooltipProvider delay={300}>{children}</TooltipProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
