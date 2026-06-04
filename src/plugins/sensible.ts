import sensible from "@fastify/sensible";
import fp from "fastify-plugin";

export const sensiblePlugin = fp(async (app) => {
  await app.register(sensible);
});
