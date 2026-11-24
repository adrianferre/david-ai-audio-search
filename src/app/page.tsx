import { AudioBrowser } from "@/components/audios/audio-browser";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">AI Audio Search</h1>
        <ThemeToggle />
      </header>
      <AudioBrowser />
    </div>
  );
}
