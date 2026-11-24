"use client";

import { useState } from "react";

import { AudioDetailPanel } from "./audio-detail-panel";
import { AudioList } from "./audio-list";

export function AudioBrowser() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1">
      <AudioList selectedId={selectedId} onSelect={setSelectedId} />
      {selectedId && (
        <AudioDetailPanel id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
