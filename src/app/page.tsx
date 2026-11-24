import { AudioBrowser } from "@/components/audios/audio-browser";
import { DavidAiLogo } from "@/components/david-ai-logo";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <DavidAiLogo className="h-7 w-auto shrink-0" />
          <div aria-hidden="true" className="h-5 w-px bg-border" />
          <h1 className="text-lg font-semibold tracking-tight">Audio Search</h1>
        </div>
      </header>
      <AudioBrowser />
    </div>
  );
}
