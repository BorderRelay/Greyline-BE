import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import {
  sellBulkItems,
  sellSingleItem,
  type SellResult,
} from "../../../repositories/sell.repository.js";

const SellItemBody = Type.Object({
  inventoryItemId: Type.String({ format: "uuid" }),
  quantity: Type.Integer({ minimum: 1 }),
});

const SellBulkBody = Type.Object({
  items: Type.Array(SellItemBody, { minItems: 1 }),
});

const SoldLine = Type.Object({
  inventoryItemId: Type.String(),
  itemDefinitionId: Type.String(),
  quantity: Type.Integer(),
  unitPrice: Type.Integer(),
  totalPrice: Type.Integer(),
});

const SellReply = Type.Object({
  ok: Type.Boolean(),
  money: Type.Integer(),
  sale: Type.Object({
    saleId: Type.String(),
    totalPrice: Type.Integer(),
  }),
  sold: Type.Array(SoldLine),
});

function toReply(result: SellResult) {
  return {
    ok: true,
    money: result.money,
    sale: {
      saleId: result.saleId,
      totalPrice: result.totalPrice,
    },
    sold: result.sold,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
export const sellRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/item", {
    schema: {
      body: SellItemBody,
      response: { 200: SellReply },
      tags: ["sell"],
      summary: "Sell a single stash item to the NPC merchant",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { inventoryItemId, quantity } = request.body;

      const result = await sellSingleItem(
        app.db,
        request.auth.accountId,
        inventoryItemId,
        quantity,
      );

      return toReply(result);
    },
  });

  app.post("/bulk", {
    schema: {
      body: SellBulkBody,
      response: { 200: SellReply },
      tags: ["sell"],
      summary: "Sell multiple stash items to the NPC merchant in one transaction",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { items } = request.body;

      const result = await sellBulkItems(app.db, request.auth.accountId, items);

      return toReply(result);
    },
  });
};
