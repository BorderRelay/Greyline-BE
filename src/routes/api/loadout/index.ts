import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { equipItem, getLoadout, unequipItem } from "../../../repositories/loadout.repository.js";

const VALID_SLOTS = ["primary_weapon", "secondary_weapon", "consumable_1", "consumable_2"] as const;

const SlotItem = Type.Object({
  slotName: Type.String(),
  inventoryItemId: Type.Union([Type.String(), Type.Null()]),
  itemDefinitionId: Type.Union([Type.String(), Type.Null()]),
  quantity: Type.Union([Type.Integer(), Type.Null()]),
  loadedAmmoCount: Type.Union([Type.Integer(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  type: Type.Union([Type.String(), Type.Null()]),
  ammoType: Type.Union([Type.String(), Type.Null()]),
  weaponClass: Type.Union([Type.String(), Type.Null()]),
  magazineSize: Type.Union([Type.Integer(), Type.Null()]),
});

const EquipBody = Type.Object({
  inventoryItemId: Type.String({ format: "uuid" }),
  slotName: Type.String(),
});

const UnequipBody = Type.Object({
  slotName: Type.String(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const loadoutRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/", {
    schema: {
      response: { 200: Type.Array(SlotItem) },
      tags: ["loadout"],
      summary: "Get current loadout state",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const rows = await getLoadout(app.db, request.auth.accountId);

      return rows.map((row) => ({
        slotName: row.slot_name,
        inventoryItemId: row.inventory_item_id,
        itemDefinitionId: row.item_definition_id,
        quantity: row.quantity,
        loadedAmmoCount: row.loaded_ammo_count,
        name: row.name,
        type: row.type,
        ammoType: row.ammo_type,
        weaponClass: row.weapon_class,
        magazineSize: row.magazine_size,
      }));
    },
  });

  app.post("/equip", {
    schema: {
      body: EquipBody,
      tags: ["loadout"],
      summary: "Equip an item from stash into a loadout slot",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { inventoryItemId, slotName } = request.body;

      if (!(VALID_SLOTS as readonly string[]).includes(slotName)) {
        throw new AppError(422, "INVALID_SLOT", `Invalid slot name: '${slotName}'.`);
      }

      await equipItem(app.db, request.auth.accountId, inventoryItemId, slotName);

      return reply.status(204).send();
    },
  });

  app.post("/unequip", {
    schema: {
      body: UnequipBody,
      tags: ["loadout"],
      summary: "Unequip item from a loadout slot back to stash",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { slotName } = request.body;

      if (!(VALID_SLOTS as readonly string[]).includes(slotName)) {
        throw new AppError(422, "INVALID_SLOT", `Invalid slot name: '${slotName}'.`);
      }

      await unequipItem(app.db, request.auth.accountId, slotName);

      return reply.status(204).send();
    },
  });
};
