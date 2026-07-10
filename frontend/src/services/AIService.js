// Public entry point for AI-related functionality — kept as a thin re-export
// so every existing `import { AIService } from "@/services/AIService"` call
// site is unaffected. Implementation lives in ./ai/*, split by responsibility:
// core (chat plumbing), tagging, relatedness, personaSuggestions, pulseGen,
// specialistGen, gaiaChat, tokenStats.
import { keywordTags } from "@/services/chatParser";
import { isConfigured, test, getTokenStats, clearTokenStats } from "./ai/tokenStats";
import { suggestTags } from "./ai/tagging";
import { findRelated } from "./ai/relatedness";
import { suggestPersonaKenmerken, reflectTemporalBeliefs } from "./ai/personaSuggestions";
import { generatePulse } from "./ai/pulseGen";
import { generateSpecialistPrompt } from "./ai/specialistGen";
import { chatWithHermes, chatWithGaia, chatWithSpecialist } from "./ai/gaiaChat";

export const AIService = {
  isConfigured,
  test,
  suggestTags,
  findRelated,
  suggestPersonaKenmerken,
  generatePulse,
  reflectTemporalBeliefs,
  generateSpecialistPrompt,
  chatWithHermes,
  chatWithGaia,
  chatWithSpecialist,
  getTokenStats,
  clearTokenStats,
};

export { keywordTags };
