import { objectRepository } from "@/repositories";
import { auditMemoryIntegrity, purgeOrphanDerivedIndexes } from "@/services/memoryApi";
import { loadDataInventory } from "@/services/maintenanceApi";

async function currentObjectIds() {
  return (await objectRepository.list()).map((object) => object.id);
}

export async function runIntegrityAudit() {
  const objectIds = await currentObjectIds();
  const [memory, inventory] = await Promise.all([
    auditMemoryIntegrity(objectIds),
    loadDataInventory(),
  ]);
  return {
    ...memory,
    missingAttachments: {
      count: inventory.attachments.missingReferencedCount || 0,
      items: inventory.attachments.missingReferencedIds || [],
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function repairOrphanDerivedIndexes() {
  return purgeOrphanDerivedIndexes(await currentObjectIds());
}
