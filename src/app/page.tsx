import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-end p-4">
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-24 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          AI Audio Search
        </h1>
        <p className="max-w-md text-muted-foreground">
          Project scaffolded. Start building in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
            src/app/page.tsx
          </code>
          .
        </p>
      </main>
    </div>
  );
}
