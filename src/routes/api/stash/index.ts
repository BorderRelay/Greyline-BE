import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { getStash } from "../../../repositories/stash.repository.js";

const StashItem = Type.Object({
  inventoryItemId: Type.String(),
  itemDefinitionId: Type.String(),
  quantity: Type.Integer(),
  loadedAmmoCount: Type.Union([Type.Integer(), Type.Null()]),
  name: Type.String(),
  type: Type.String(),
  weight: Type.Number(),
  baseValue: Type.Integer(),
  stackable: Type.Boolean(),
  maxStack: Type.Integer(),
});

const Reply = Type.Object({
  accountId: Type.String(),
  money: Type.Integer(),
  items: Type.Array(StashItem),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const stashRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/", {
    schema: {
      response: { 200: Reply },
      tags: ["stash"],
      summary: "Get current account stash and money",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const accountId = request.auth.accountId;
      const stash = await getStash(app.db, accountId);

      return {
        accountId,
        money: Number(stash.money),
        items: stash.items.map((item) => ({
          inventoryItemId: item.inventory_item_id,
          itemDefinitionId: item.item_definition_id,
          quantity: item.quantity,
          loadedAmmoCount: item.loaded_ammo_count,
          name: item.name,
          type: item.type,
          weight: Number(item.weight),
          baseValue: item.base_value,
          stackable: item.stackable,
          maxStack: item.max_stack,
        })),
      };
    },
  });
};
