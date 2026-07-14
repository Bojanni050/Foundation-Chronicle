import { objectRepository } from "@/repositories";
import { getValidTypeKeys } from "@/lib/typeRegistry";
import { getSourceUsage } from "@/services/memoryApi";

function formatEpisode(episode, index) {
  const details = [
    episode.spreker ? `Speaker: ${episode.spreker}` : null,
    episode.observed_at ? `Observed: ${new Date(episode.observed_at).toISOString()}` : null,
    episode.bron_referentie ? `Reference: ${episode.bron_referentie}` : null,
  ].filter(Boolean);
  return [
    `## Frozen observation ${index + 1}`,
    ...details,
    "",
    episode.fragment,
    episode.context_window ? `\nContext window:\n\n${episode.context_window}` : null,
  ].filter((value) => value != null).join("\n");
}

export function buildRecoveredSourceDraft(bronObjectId, episodes) {
  if (!bronObjectId || !Array.isArray(episodes) || episodes.length === 0) {
    throw new Error("No immutable episodes are available for source recovery");
  }
  const ordered = [...episodes].sort((a, b) => (a.captured_at || "").localeCompare(b.captured_at || ""));
  const bronsoort = ordered.find((episode) => episode.bronsoort)?.bronsoort || "source";
  const type = getValidTypeKeys().has(bronsoort) ? bronsoort : null;
  const observedTimes = ordered.map((episode) => episode.observed_at).filter(Boolean).sort();
  const sourceUrl = ordered
    .map((episode) => episode.bron_referentie)
    .find((reference) => /^https?:\/\//i.test(reference || "")) || null;
  const content = [
    "# Recovered evidence source",
    "",
    "This is a partial, locked reconstruction built from immutable Chronicle episodes. It is not the original source object.",
    `Original object id: ${bronObjectId}`,
    `Recovered episode count: ${ordered.length}`,
    "",
    ...ordered.map(formatEpisode),
  ].join("\n\n");
  return {
    id: bronObjectId,
    type,
    title: `Recovered ${bronsoort} source`,
    content,
    tags: ["recovered", "evidence-source"],
    occurredAt: observedTimes[0] || null,
    source: "episode-recovery",
    sourceUrl,
    locked: true,
  };
}

export async function previewSourceRecovery(bronObjectId) {
  if (await objectRepository.getById(bronObjectId)) {
    throw new Error("The source object already exists");
  }
  const usage = await getSourceUsage(bronObjectId);
  const draft = buildRecoveredSourceDraft(bronObjectId, usage.episodes || []);
  return {
    bronObjectId,
    draft,
    episodeCount: usage.episodeCount,
    evidenceCount: usage.evidenceCount,
    hypothesisCount: usage.hypothesisCount,
  };
}

export async function recoverSourceFromEpisodes(bronObjectId) {
  const preview = await previewSourceRecovery(bronObjectId);
  const created = await objectRepository.create(preview.draft);
  return { ...preview, object: created };
}
