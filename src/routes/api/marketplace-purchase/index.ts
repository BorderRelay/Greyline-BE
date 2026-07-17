import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import {
  purchaseListing,
  type PurchaseListingResult,
} from "../../../repositories/marketplace-purchase.repository.js";

const PurchaseBody = Type.Object({
  listingId: Type.String({ format: "uuid" }),
});

const PurchaseReply = Type.Object({
  ok: Type.Boolean(),
  money: Type.Integer(),
  purchase: Type.Object({
    purchaseId: Type.String(),
    listingId: Type.String(),
    itemDefinitionId: Type.String(),
    quantity: Type.Integer(),
    grossPrice: Type.Integer(),
    feeAmount: Type.Integer(),
    sellerNetAmount: Type.Integer(),
  }),
  item: Type.Object({
    inventoryItemId: Type.String(),
    itemDefinitionId: Type.String(),
    quantity: Type.Integer(),
  }),
});

function toReply(result: PurchaseListingResult) {
  return {
    ok: true,
    money: result.money,
    purchase: {
      purchaseId: result.purchaseId,
      listingId: result.listingId,
      itemDefinitionId: result.itemDefinitionId,
      quantity: result.quantity,
      grossPrice: result.grossPrice,
      feeAmount: result.feeAmount,
      sellerNetAmount: result.sellerNetAmount,
    },
    item: result.item,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
export const marketplacePurchaseRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/", {
    schema: {
      body: PurchaseBody,
      response: { 200: PurchaseReply },
      tags: ["marketplace"],
      summary: "Purchase (buy now) an active marketplace listing",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { listingId } = request.body;

      const result = await purchaseListing(app.db, request.auth.accountId, listingId);

      return toReply(result);
    },
  });
};
