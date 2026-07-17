import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import { acceptRaidResult } from "../../../repositories/raid-result.repository.js";

const ExtractedItem = Type.Object({
  itemDefinitionId: Type.String(),
  quantity: Type.Integer({ minimum: 1 }),
});

const DeathPosition = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
});

const RaidResultBody = Type.Object({
  raidId: Type.String({ format: "uuid" }),
  result: Type.Union([Type.Literal("success"), Type.Literal("failure")]),
  startedAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
  endedAt: Type.String({ format: "date-time" }),
  extractionPointId: Type.Union([Type.String(), Type.Null()]),
  deathPosition: Type.Union([DeathPosition, Type.Null()]),
  extractedItems: Type.Array(ExtractedItem),
});

const RaidResultReply = Type.Object({
  accepted: Type.Boolean(),
  raidId: Type.String(),
  result: Type.Union([Type.Literal("success"), Type.Literal("failure")]),
  stashUpdated: Type.Boolean(),
});

// eslint-disable-next-line @typescript-eslint/require-await
export const raidResultRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/", {
    schema: {
      body: RaidResultBody,
      response: { 200: RaidResultReply },
      tags: ["raid-results"],
      summary: "Submit a finished raid result",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const {
        raidId,
        result,
        startedAt,
        endedAt,
        extractionPointId,
        deathPosition,
        extractedItems,
      } = request.body;

      return acceptRaidResult(app.db, request.auth.accountId, {
        raidId,
        result,
        startedAt: startedAt ?? null,
        endedAt,
        extractionPointId,
        deathPosition,
        extractedItems,
      });
    },
  });
};
