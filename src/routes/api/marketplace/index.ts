import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

import { AppError } from "../../../lib/app-error.js";
import {
  LISTING_DURATION_HOURS,
  browseActiveListings,
  cancelListing,
  createListing,
  getListingById,
  listMyListings,
  type ListingSummary,
} from "../../../repositories/marketplace.repository.js";

const ItemTypeLiteral = Type.Union([
  Type.Literal("weapon"),
  Type.Literal("ammo"),
  Type.Literal("medical"),
  Type.Literal("food"),
  Type.Literal("parts"),
  Type.Literal("valuable"),
]);

const ListingStatusLiteral = Type.Union([
  Type.Literal("active"),
  Type.Literal("sold"),
  Type.Literal("cancelled"),
  Type.Literal("expired"),
]);

const DurationHoursLiteral = Type.Union(LISTING_DURATION_HOURS.map((hours) => Type.Literal(hours)));

const CreateListingBody = Type.Object({
  inventoryItemId: Type.String({ format: "uuid" }),
  quantity: Type.Integer({ minimum: 1 }),
  unitPrice: Type.Integer({ minimum: 1 }),
  durationHours: DurationHoursLiteral,
});

const BrowseQuery = Type.Object({
  itemType: Type.Optional(ItemTypeLiteral),
  sort: Type.Optional(
    Type.Union([Type.Literal("newest"), Type.Literal("price_asc"), Type.Literal("price_desc")]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const MineQuery = Type.Object({
  status: Type.Optional(ListingStatusLiteral),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const ListingIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

const ListingReply = Type.Object({
  listingId: Type.String(),
  sellerAccountId: Type.String(),
  inventoryItemId: Type.String(),
  itemDefinitionId: Type.String(),
  itemName: Type.String(),
  itemType: Type.String(),
  quantity: Type.Integer(),
  listedUnitPrice: Type.Integer(),
  totalListedPrice: Type.Integer(),
  feePolicyType: Type.String(),
  feeRateBps: Type.Union([Type.Integer(), Type.Null()]),
  feeFlatAmount: Type.Union([Type.Integer(), Type.Null()]),
  status: ListingStatusLiteral,
  expiresAt: Type.String(),
  cancelledAt: Type.Union([Type.String(), Type.Null()]),
  soldAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const ListingListReply = Type.Object({
  items: Type.Array(ListingReply),
});

function toReply(listing: ListingSummary) {
  return listing;
}

// eslint-disable-next-line @typescript-eslint/require-await
export const marketplaceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post("/listings", {
    schema: {
      body: CreateListingBody,
      response: { 200: ListingReply },
      tags: ["marketplace"],
      summary: "Create a marketplace listing from a stash item",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const listing = await createListing(app.db, request.auth.accountId, request.body);
      return toReply(listing);
    },
  });

  app.get("/listings", {
    schema: {
      querystring: BrowseQuery,
      response: { 200: ListingListReply },
      tags: ["marketplace"],
      summary: "Browse active marketplace listings",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { itemType, sort, limit, offset } = request.query;
      const items = await browseActiveListings(app.db, {
        itemType,
        sort: sort ?? "newest",
        limit: limit ?? 20,
        offset: offset ?? 0,
      });

      return { items: items.map(toReply) };
    },
  });

  app.get("/listings/mine", {
    schema: {
      querystring: MineQuery,
      response: { 200: ListingListReply },
      tags: ["marketplace"],
      summary: "List the caller's own marketplace listings (all statuses)",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const { status, limit, offset } = request.query;
      const items = await listMyListings(app.db, request.auth.accountId, {
        status,
        limit: limit ?? 20,
        offset: offset ?? 0,
      });

      return { items: items.map(toReply) };
    },
  });

  app.get("/listings/:id", {
    schema: {
      params: ListingIdParams,
      response: { 200: ListingReply },
      tags: ["marketplace"],
      summary: "Get a single marketplace listing's detail",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const listing = await getListingById(app.db, request.params.id, request.auth.accountId);
      return toReply(listing);
    },
  });

  app.post("/listings/:id/cancel", {
    schema: {
      params: ListingIdParams,
      response: { 200: ListingReply },
      tags: ["marketplace"],
      summary: "Cancel the caller's own active listing and return the item to stash",
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");

      const listing = await cancelListing(app.db, request.auth.accountId, request.params.id);
      return toReply(listing);
    },
  });
};
