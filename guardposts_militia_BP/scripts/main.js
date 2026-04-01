/* Project Moat - Production Script
 * Stable, non-beta, deterministic guard behavior
 */

import { world, system } from "@minecraft/server";

const KEY_PREFIX = "moat_";
const tagKey = (k) => `${KEY_PREFIX}${k}`;

// How long (in ticks) after combat we wait before snapping back
// 20 ticks = 1 second
const COMBAT_COOLDOWN_TICKS = 60; // ~3 seconds

// =====================================================
// TAG HELPERS
// =====================================================

function setTagKV(entity, key, value) {
  if (
    !entity ||
    typeof entity !== "object" ||
    typeof entity.getTags !== "function"
  )
    return;

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
  if (
    !entity ||
    typeof entity !== "object" ||
    typeof entity.getTags !== "function"
  )
    return undefined;

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

// =====================================================
// SPAWN: POST → ENTITY
// =====================================================

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  const { block, player } = ev;
  let entityId;

  if (block.typeId === "projectmoat:guardpost") {
    entityId = "projectmoat:recruit";
  } else if (block.typeId === "projectmoat:archerpost") {
    entityId = "projectmoat:hunter";
  }

  if (!entityId) return;

  const spawnPos = {
    x: block.location.x + 0.5,
    y: block.location.y + 1,
    z: block.location.z + 0.5,
  };

  const entity = block.dimension.spawnEntity(entityId, spawnPos);

  system.run(() => {
    try {
      // Face the player on spawn (original behavior)
      const dx = player.location.x - spawnPos.x;
      const dz = player.location.z - spawnPos.z;
      const yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
      entity.setRotation({ x: 0, y: yaw });

      // Store post metadata
      setTagKV(entity, "home_block_type", block.typeId);
      setTagKV(entity, "home_block_x", block.location.x);
      setTagKV(entity, "home_block_y", block.location.y);
      setTagKV(entity, "home_block_z", block.location.z);
    } catch (e) {
      console.warn(">>> SPAWN SETUP FAILED:", e);
    }
  });
});

// =====================================================
// DEATH: ENTITY → REMOVE POST
// =====================================================

world.afterEvents.entityDie.subscribe((ev) => {
  const entity = ev.deadEntity;

  if (
    entity.typeId !== "projectmoat:recruit" &&
    entity.typeId !== "projectmoat:hunter"
  )
    return;

  const btype = getTagKV(entity, "home_block_type");
  const bx = getTagKV(entity, "home_block_x");
  const by = getTagKV(entity, "home_block_y");
  const bz = getTagKV(entity, "home_block_z");

  if (!btype || bx === undefined) return;

  const block = entity.dimension.getBlock({ x: bx, y: by, z: bz });

  if (block?.typeId === btype) {
    try {
      block.setType("minecraft:air");
      console.warn(">>> a guard was lost <<<");
    } catch {}
  }
});

// =====================================================
// STABLE POST ENFORCEMENT (COMBAT-AWARE)
// =====================================================
//
// Invariant:
//   - When NOT in combat
//   - AND not standing on their post
//   - Snap ONCE back to the post
//
// Combat is detected with a short cooldown window to
// avoid snapping during target reacquisition.
//

const POST_CHECK_INTERVAL = 200; // ~2 seconds
const POST_RADIUS_SQ = 0.16;    // ~0.4 blocks

system.runInterval(() => {
  const overworld = world.getDimension("overworld");

  // 2.7+ requires one type per query
  const entities = [
    ...overworld.getEntities({ type: "projectmoat:recruit" }),
    ...overworld.getEntities({ type: "projectmoat:hunter" }),
  ];

  const currentTick = system.currentTick;

  for (const entity of entities) {
    // If entity currently has a target, treat as in combat
    if (entity.getTarget?.()) {
      setTagKV(entity, "last_combat_tick", currentTick);
      continue;
    }

    // Respect combat cooldown to avoid mid-fight snapping
    const lastCombat = getTagKV(entity, "last_combat_tick");
    if (
      typeof lastCombat === "number" &&
      currentTick - lastCombat < COMBAT_COOLDOWN_TICKS
    ) {
      continue;
    }

    const hx = getTagKV(entity, "home_block_x");
    const hy = getTagKV(entity, "home_block_y");
    const hz = getTagKV(entity, "home_block_z");
    if (hx === undefined) continue;

    const homeX = hx + 0.5;
    const homeZ = hz + 0.5;

    const dx = entity.location.x - homeX;
    const dz = entity.location.z - homeZ;

    // Only correct if visibly off-post
    if (dx * dx + dz * dz > POST_RADIUS_SQ) {
      try {
        entity.teleport(
          { x: homeX, y: hy + 1, z: homeZ },
          { dimension: entity.dimension }
        );
      } catch {}
    }
  }
}, POST_CHECK_INTERVAL);