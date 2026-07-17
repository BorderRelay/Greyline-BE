import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env, type AppConfig } from "../src/config/env.js";

const apps = new Set<ReturnType<typeof buildApp>>();

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...env, NODE_ENV: "test", SWAGGER_ENABLED: false, ...overrides };
}

function createApp(overrides: Partial<AppConfig> = {}) {
  const app = buildApp({ config: createConfig(overrides) });
  apps.add(app);
  return app;
}

afterEach(async () => {
  await Promise.allSettled([...apps].map((app) => app.close()));
  apps.clear();
});

type ItemDefinitionRow = {
  id: string;
  name: string;
  type: string;
  weight: string;
  base_value: number;
  stackable: boolean;
  max_stack: number;
  usable_in_raid: boolean;
  ammo_type: string | null;
  weapon_class: string | null;
  magazine_size: number | null;
  heal_amount: number | null;
  marketplace_policy: string;
};

const SEEDED_ITEM_IDS = [
  "weapon_pistol_01",
  "weapon_rifle_01",
  "ammo_9mm_01",
  "ammo_556_01",
  "medical_bandage_01",
  "food_canned_01",
  "parts_scrap_01",
  "valuable_gold_watch_01",
];

async function fetchItemDefinitions(app: ReturnType<typeof buildApp>) {
  await app.ready();
  const result = await app.db.query<ItemDefinitionRow>(
    `select * from greyline_be.item_definitions where id = any($1::text[])`,
    [SEEDED_ITEM_IDS],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

describe("item_definitions seed data", () => {
  it("seeds at least one item for every required category", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    const types = new Set([...items.values()].map((item) => item.type));
    expect(types).toEqual(new Set(["weapon", "ammo", "medical", "food", "parts", "valuable"]));
  });

  it("seeds the reference pistol with weapon-required fields", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    const pistol = items.get("weapon_pistol_01");
    expect(pistol).toMatchObject({
      name: "Rust Pistol",
      type: "weapon",
      base_value: 500,
      stackable: false,
      max_stack: 1,
      ammo_type: "9mm",
      weapon_class: "pistol",
      magazine_size: 7,
    });
    expect(Number(pistol!.weight)).toBe(3.5);
  });

  it("seeds the reference rifle with weapon-required fields", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    const rifle = items.get("weapon_rifle_01");
    expect(rifle).toMatchObject({
      name: "Scrap Rifle",
      type: "weapon",
      stackable: false,
      max_stack: 1,
      ammo_type: "5.56mm",
      weapon_class: "rifle",
      magazine_size: 20,
    });
  });

  it("seeds ammo rows with an ammo_type set", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    for (const id of ["ammo_9mm_01", "ammo_556_01"]) {
      const ammo = items.get(id);
      expect(ammo?.type).toBe("ammo");
      expect(ammo?.ammo_type).not.toBeNull();
    }
  });

  it("seeds the medical item with a heal_amount", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    const bandage = items.get("medical_bandage_01");
    expect(bandage).toMatchObject({
      name: "Bandage",
      type: "medical",
    });
    expect(bandage!.heal_amount).not.toBeNull();
    expect(bandage!.heal_amount).toBeGreaterThan(0);
  });

  it("seeds food, parts, and valuable reference items", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    expect(items.get("food_canned_01")).toMatchObject({ type: "food" });
    expect(items.get("parts_scrap_01")).toMatchObject({ type: "parts" });
    expect(items.get("valuable_gold_watch_01")).toMatchObject({
      type: "valuable",
      stackable: false,
      max_stack: 1,
    });
  });

  it("satisfies the seed validation rules from the DB spec (§15)", async () => {
    const app = createApp();
    const items = await fetchItemDefinitions(app);

    for (const item of items.values()) {
      if (item.type === "weapon") {
        expect(item.ammo_type, `weapon ${item.id} must have ammo_type`).not.toBeNull();
      }
      if (item.type === "ammo") {
        expect(item.ammo_type, `ammo ${item.id} must have ammo_type`).not.toBeNull();
      }
      if (item.type === "medical") {
        expect(item.heal_amount, `medical ${item.id} must have heal_amount`).not.toBeNull();
      }
      if (!item.stackable) {
        expect(item.max_stack, `non-stackable ${item.id} must have max_stack = 1`).toBe(1);
      }
    }
  });
});
