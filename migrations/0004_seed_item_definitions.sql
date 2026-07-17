-- item_definitions seed data
-- covers minimum categories required by database-schema-implementation-spec.md §15:
-- weapon (pistol, rifle), ammo, medical, food, parts, valuable
-- idempotent via ON CONFLICT DO NOTHING so re-running migrations stays safe

insert into greyline_be.item_definitions
  (id, name, type, description, weight, base_value, stackable, max_stack, usable_in_raid,
   ammo_type, weapon_class, magazine_size, heal_amount, marketplace_policy)
values
  ('weapon_pistol_01', 'Rust Pistol', 'weapon',
   'A worn semi-automatic pistol chambered in 9mm.',
   3.5, 500, false, 1, true,
   '9mm', 'pistol', 7, null, 'tradable'),

  ('weapon_rifle_01', 'Scrap Rifle', 'weapon',
   'A cobbled-together rifle chambered in 5.56mm.',
   6.0, 1200, false, 1, true,
   '5.56mm', 'rifle', 20, null, 'tradable'),

  ('ammo_9mm_01', '9mm Rounds', 'ammo',
   'Standard 9mm ammunition, compatible with 9mm pistols.',
   0.01, 5, true, 60, true,
   '9mm', null, null, null, 'tradable'),

  ('ammo_556_01', '5.56mm Rounds', 'ammo',
   'Standard 5.56mm ammunition, compatible with 5.56mm rifles.',
   0.02, 8, true, 60, true,
   '5.56mm', null, null, null, 'tradable'),

  ('medical_bandage_01', 'Bandage', 'medical',
   'A basic bandage that stops bleeding and restores a small amount of health.',
   0.2, 50, true, 5, true,
   null, null, null, 25, 'tradable'),

  ('food_canned_01', 'Canned Food', 'food',
   'Preserved canned food that staves off hunger during a raid.',
   0.4, 30, true, 5, true,
   null, null, null, null, 'tradable'),

  ('parts_scrap_01', 'Scrap Metal Parts', 'parts',
   'Salvaged metal parts used for crafting and repairs.',
   1.0, 40, true, 10, false,
   null, null, null, null, 'tradable'),

  ('valuable_gold_watch_01', 'Gold Watch', 'valuable',
   'An antique gold watch with no use beyond its resale value.',
   0.1, 300, false, 1, false,
   null, null, null, null, 'tradable')
on conflict (id) do nothing;
