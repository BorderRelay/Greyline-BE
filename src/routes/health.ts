import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance) {
  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              service: { type: "string" },
            },
            required: ["ok", "service"],
          },
        },
      },
    },
    () => {
      return {
        ok: true,
        service: "greyline-be",
      };
    },
  );
}
