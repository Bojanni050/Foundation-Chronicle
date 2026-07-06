import { FileX2 } from "lucide-react";

export function Blob({ className = "" }) {
  return (
    <div
      className={`warm-blob rounded-[28px] ${className}`}
      style={{ boxShadow: "0 1px 0 hsl(34 30% 80% / 0.4)" }}
      aria-hidden
    />
  );
}

export function ListEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center fade-in" data-testid="list-empty-state">
      <Blob className="w-40 h-48 mb-8" />
      <FileX2 className="w-6 h-6 text-primary/70 mb-3" strokeWidth={1.5} />
      <h3 className="font-serif text-xl text-ink">Nothing here yet</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-[220px]">
        Capture a thought to begin your stack.
      </p>
    </div>
  );
}

export function WelcomeEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center fade-in" data-testid="welcome-empty-state">
      <Blob className="w-52 h-60 mb-8" />
      <h2 className="font-serif text-3xl text-ink">A calm space to think</h2>
      <p className="text-base text-muted-foreground mt-3 max-w-[380px] leading-relaxed">
        Capture notes, people, ideas and projects as objects. Chronicle's AI
        quietly weaves them together for you.
      </p>
    </div>
  );
}
