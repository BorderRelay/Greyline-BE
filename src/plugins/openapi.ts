import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";

import type { AppConfig } from "../config/env.js";

export const openApiPlugin = fp<{ config: AppConfig }>(async (app, options) => {
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: options.config.APP_NAME,
        version: options.config.APP_VERSION,
        description: "Greyline backend API",
      },
      servers: [
        {
          url: `http://localhost:${options.config.PORT}`,
          description: "Local server",
        },
      ],
      tags: [
        { name: "system", description: "System and infrastructure endpoints" },
        { name: "auth", description: "Authentication endpoints" },
        { name: "stash", description: "Stash and inventory endpoints" },
        { name: "loadout", description: "Loadout management endpoints" },
        { name: "sell", description: "NPC sell (shop) endpoints" },
        { name: "raid-results", description: "Raid result submission endpoints" },
        { name: "marketplace", description: "Player marketplace listing endpoints" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  if (!options.config.SWAGGER_ENABLED) {
    return;
  }

  await app.register(swaggerUi, {
    routePrefix: options.config.SWAGGER_ROUTE_PREFIX,
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    staticCSP: true,
  });
});
