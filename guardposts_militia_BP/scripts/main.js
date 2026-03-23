/* Project Moat - Minimal Script (Spawn + Death Cleanup Only) */

import { world, system } from "@minecraft/server";

const KEY_PREFIX = "moat_";
const tagKey = (k) => `${KEY_PREFIX}${k}`;

// Tag helpers (for death cleanup)
function setTagKV(entity, key, value) {
  if (!entity || typeof entity !== 'object' || typeof entity.getTags !== 'function') return;

  const fullKey = tagKey(key);
  try {
    const tags = entity.getTags();
    for (const t of tags) {
      if (t.startsWith(fullKey + "=")) entity.removeTag(t);
    }
    entity.addTag(`${fullKey}=${JSON.stringify(value)}`);
  } catch {}
}

function getTagKV(entity, key) {
  if (!entity || typeof entity !== 'object' || typeof entity.getTags !== 'function') return undefined;

  const fullKey = tagKey(key);
  try {
    const tags = entity.getTags();
    for (const t of tags) {
      if (t.startsWith(fullKey + "=")) {
        return JSON.parse(t.substring(fullKey.length + 1));
      }
    }
  } catch {}
  return undefined;
}

// SPAWN: Precise pos + face player + save post info for death cleanup
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  const { block, player } = ev;
  let entityId;
  if (block.typeId === "projectmoat:guardpost") entityId = "projectmoat:recruit";
  else if (block.typeId === "projectmoat:archerpost") entityId = "projectmoat:hunter";
  if (!entityId) return;

  const spawnPos = { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 };
  const entity = block.dimension.spawnEntity(entityId, spawnPos);

  system.run(() => {
    try {
      const dx = player.location.x - spawnPos.x;
      const dz = player.location.z - spawnPos.z;
      const yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
      entity.setRotation({ x: 0, y: yaw });

      setTagKV(entity, "home_block_type", block.typeId);
      setTagKV(entity, "home_block_x", block.location.x);
      setTagKV(entity, "home_block_y", block.location.y);
      setTagKV(entity, "home_block_z", block.location.z);

    } catch (e) {
      console.warn(">>> SPAWN SETUP FAILED: " + e);
    }
  });
});

// DEATH: Remove post block
world.afterEvents.entityDie.subscribe((ev) => {
  const entity = ev.deadEntity;
  if (entity.typeId !== "projectmoat:recruit" && entity.typeId !== "projectmoat:hunter") return;

  const btype = getTagKV(entity, "home_block_type");
  const bx = getTagKV(entity, "home_block_x");
  if (!btype || bx === undefined) return;

  const block = entity.dimension.getBlock({
    x: bx,
    y: getTagKV(entity, "home_block_y"),
    z: getTagKV(entity, "home_block_z")
  });

  if (block?.typeId === btype) {
    try {
      block.setType("minecraft:air");
      console.warn(">>> a guard was lost <<<");
    } catch {}
  }
});