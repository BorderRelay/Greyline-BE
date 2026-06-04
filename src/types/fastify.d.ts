import type { Pool } from "pg";

import type { AuthContext } from "./auth.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
    requireAuth: (request: FastifyRequest) => void | Promise<void>;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
