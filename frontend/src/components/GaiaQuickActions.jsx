// Fixed, predefined quick-action shortcuts shown in Gaia's chat empty state.
// Deliberately NOT dynamically generated HTML/onclick strings — Gaia's own
// responses (LLM output, potentially shaped by ingested content) never
// control what renders or executes here. Each action is a hardcoded prompt
// string routed through the exact same chatWithGaia() flow as anything the
// user types themselves.
import { Sparkles, MessageCircleQuestion, TrendingUp } from "lucide-react";

export const GAIA_QUICK_ACTIONS = [
  {
    id: "analyseer-voorkeuren",
    label: "Mijn voorkeuren analyseren",
    icon: Sparkles,
    prompt: "Analyseer mijn bevestigde persona-kenmerken en geef een kort overzicht van mijn belangrijkste voorkeuren en werkwijzen.",
  },
  {
    id: "gewoontes-visualiseren",
    label: "Gewoontes samenvatten",
    icon: TrendingUp,
    prompt: "Welke terugkerende gewoontes of patronen zie je in mijn recente activiteit? Geef een kort overzicht.",
  },
  {
    id: "specifieke-vraag",
    label: "Iets specifieks vragen",
    icon: MessageCircleQuestion,
    prompt: "",
  },
];

export function GaiaQuickActions({ onSelect }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 pt-2">
      {GAIA_QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onSelect(action.prompt)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-[11px] text-ink hover:bg-accent/40 hover:border-primary/40 transition-colors"
          >
            <Icon className="w-3.5 h-3.5 text-primary" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
