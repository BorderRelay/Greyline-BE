import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox";

export const healthRoutePlugin: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Service health check",
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            service: Type.String(),
          }),
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

  done();
};
