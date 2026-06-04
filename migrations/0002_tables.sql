-- accounts
create table greyline_be.accounts (
  id           uuid        primary key,
  email        text        unique,
  password_hash text,
  status       text        not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_login_at timestamptz
);

alter table greyline_be.accounts
  add constraint accounts_status_check
  check (status in ('active', 'disabled', 'deleted'));

-- account_profiles
create table greyline_be.account_profiles (
  account_id uuid        primary key references greyline_be.accounts(id) on delete cascade,
  money      bigint      not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table greyline_be.account_profiles
  add constraint account_profiles_money_nonnegative
  check (money >= 0);

-- item_definitions
create table greyline_be.item_definitions (
  id                 text           primary key,
  name               text           not null,
  type               text           not null,
  description        text,
  weight             numeric(10,2)  not null,
  base_value         integer        not null,
  stackable          boolean        not null,
  max_stack          integer        not null default 1,
  usable_in_raid     boolean        not null default false,
  ammo_type          text,
  weapon_class       text,
  magazine_size      integer,
  heal_amount        integer,
  marketplace_policy text           not null default 'tradable',
  metadata           jsonb          not null default '{}'::jsonb,
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now()
);

alter table greyline_be.item_definitions
  add constraint item_definitions_type_check
  check (type in ('weapon', 'ammo', 'medical', 'food', 'parts', 'valuable'));

alter table greyline_be.item_definitions
  add constraint item_definitions_weight_nonnegative
  check (weight >= 0);

alter table greyline_be.item_definitions
  add constraint item_definitions_base_value_nonnegative
  check (base_value >= 0);

alter table greyline_be.item_definitions
  add constraint item_definitions_max_stack_positive
  check (max_stack >= 1);

alter table greyline_be.item_definitions
  add constraint item_definitions_magazine_size_nonnegative
  check (magazine_size is null or magazine_size >= 0);

alter table greyline_be.item_definitions
  add constraint item_definitions_heal_amount_nonnegative
  check (heal_amount is null or heal_amount >= 0);

alter table greyline_be.item_definitions
  add constraint item_definitions_marketplace_policy_check
  check (marketplace_policy in ('tradable', 'non_tradable'));

-- inventory_items
create table greyline_be.inventory_items (
  id                  uuid          primary key,
  account_id          uuid          not null references greyline_be.accounts(id) on delete cascade,
  item_definition_id  text          not null references greyline_be.item_definitions(id),
  quantity            integer       not null default 1,
  location_type       text          not null,
  location_ref        text,
  loaded_ammo_count   integer,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

alter table greyline_be.inventory_items
  add constraint inventory_items_quantity_positive
  check (quantity > 0);

alter table greyline_be.inventory_items
  add constraint inventory_items_location_type_check
  check (location_type in ('stash', 'loadout', 'marketplace_escrow'));

alter table greyline_be.inventory_items
  add constraint inventory_items_loaded_ammo_nonnegative
  check (loaded_ammo_count is null or loaded_ammo_count >= 0);

-- loadout_slots
create table greyline_be.loadout_slots (
  account_id        uuid        not null references greyline_be.accounts(id) on delete cascade,
  slot_name         text        not null,
  inventory_item_id uuid        references greyline_be.inventory_items(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (account_id, slot_name)
);

alter table greyline_be.loadout_slots
  add constraint loadout_slots_slot_name_check
  check (slot_name in ('primary_weapon', 'secondary_weapon', 'consumable_1', 'consumable_2'));

-- raid_results
create table greyline_be.raid_results (
  id                   uuid           primary key,
  account_id           uuid           not null references greyline_be.accounts(id) on delete cascade,
  result               text           not null,
  death_x              numeric(10,2),
  death_y              numeric(10,2),
  extraction_point_id  text,
  started_at           timestamptz,
  ended_at             timestamptz    not null,
  created_at           timestamptz    not null default now()
);

alter table greyline_be.raid_results
  add constraint raid_results_result_check
  check (result in ('success', 'failure'));

-- raid_result_items
create table greyline_be.raid_result_items (
  id                  uuid        primary key,
  raid_result_id      uuid        not null references greyline_be.raid_results(id) on delete cascade,
  item_definition_id  text        not null references greyline_be.item_definitions(id),
  quantity            integer     not null,
  created_at          timestamptz not null default now()
);

alter table greyline_be.raid_result_items
  add constraint raid_result_items_quantity_positive
  check (quantity > 0);

-- npc_sales
create table greyline_be.npc_sales (
  id          uuid        primary key,
  account_id  uuid        not null references greyline_be.accounts(id) on delete cascade,
  total_price bigint      not null,
  created_at  timestamptz not null default now()
);

alter table greyline_be.npc_sales
  add constraint npc_sales_total_price_nonnegative
  check (total_price >= 0);

-- npc_sale_items
create table greyline_be.npc_sale_items (
  id                  uuid        primary key,
  npc_sale_id         uuid        not null references greyline_be.npc_sales(id) on delete cascade,
  item_definition_id  text        not null references greyline_be.item_definitions(id),
  quantity            integer     not null,
  unit_price          bigint      not null,
  total_price         bigint      not null,
  created_at          timestamptz not null default now()
);

alter table greyline_be.npc_sale_items
  add constraint npc_sale_items_quantity_positive
  check (quantity > 0);

alter table greyline_be.npc_sale_items
  add constraint npc_sale_items_unit_price_nonnegative
  check (unit_price >= 0);

alter table greyline_be.npc_sale_items
  add constraint npc_sale_items_total_price_nonnegative
  check (total_price >= 0);

-- marketplace_listings
create table greyline_be.marketplace_listings (
  id                  uuid        primary key,
  seller_account_id   uuid        not null references greyline_be.accounts(id),
  inventory_item_id   uuid        not null references greyline_be.inventory_items(id),
  item_definition_id  text        not null references greyline_be.item_definitions(id),
  quantity            integer     not null,
  listed_unit_price   bigint      not null,
  total_listed_price  bigint      not null,
  fee_policy_type     text        not null,
  fee_rate_bps        integer,
  fee_flat_amount     bigint,
  status              text        not null,
  expires_at          timestamptz not null,
  cancelled_at        timestamptz,
  sold_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table greyline_be.marketplace_listings
  add constraint marketplace_listings_quantity_positive
  check (quantity > 0);

alter table greyline_be.marketplace_listings
  add constraint marketplace_listings_price_nonnegative
  check (listed_unit_price >= 0 and total_listed_price >= 0);

alter table greyline_be.marketplace_listings
  add constraint marketplace_listings_status_check
  check (status in ('active', 'sold', 'cancelled', 'expired'));

-- marketplace_purchases
create table greyline_be.marketplace_purchases (
  id                uuid        primary key,
  listing_id        uuid        not null references greyline_be.marketplace_listings(id),
  seller_account_id uuid        not null references greyline_be.accounts(id),
  buyer_account_id  uuid        not null references greyline_be.accounts(id),
  gross_price       bigint      not null,
  fee_amount        bigint      not null,
  seller_net_amount bigint      not null,
  created_at        timestamptz not null default now()
);

alter table greyline_be.marketplace_purchases
  add constraint marketplace_purchases_gross_nonnegative
  check (gross_price >= 0);

alter table greyline_be.marketplace_purchases
  add constraint marketplace_purchases_fee_nonnegative
  check (fee_amount >= 0);

alter table greyline_be.marketplace_purchases
  add constraint marketplace_purchases_net_nonnegative
  check (seller_net_amount >= 0);

-- marketplace_purchase_items
create table greyline_be.marketplace_purchase_items (
  id                      uuid        primary key,
  marketplace_purchase_id uuid        not null references greyline_be.marketplace_purchases(id) on delete cascade,
  item_definition_id      text        not null references greyline_be.item_definitions(id),
  quantity                integer     not null,
  unit_price              bigint      not null,
  total_price             bigint      not null,
  created_at              timestamptz not null default now()
);

alter table greyline_be.marketplace_purchase_items
  add constraint marketplace_purchase_items_quantity_positive
  check (quantity > 0);

-- indexes: core
create index idx_inventory_items_account_location
  on greyline_be.inventory_items(account_id, location_type);

create index idx_inventory_items_account_item_definition
  on greyline_be.inventory_items(account_id, item_definition_id);

create index idx_inventory_items_loadout_only
  on greyline_be.inventory_items(account_id)
  where location_type = 'loadout';

create index idx_loadout_slots_account
  on greyline_be.loadout_slots(account_id);

create index idx_raid_results_account_ended_at
  on greyline_be.raid_results(account_id, ended_at desc);

create index idx_npc_sales_account_created_at
  on greyline_be.npc_sales(account_id, created_at desc);

-- indexes: marketplace
create index idx_marketplace_listings_status_expires
  on greyline_be.marketplace_listings(status, expires_at);

create index idx_marketplace_listings_item_definition
  on greyline_be.marketplace_listings(item_definition_id);

create index idx_marketplace_listings_seller_status
  on greyline_be.marketplace_listings(seller_account_id, status);

create index idx_marketplace_active_price
  on greyline_be.marketplace_listings(item_definition_id, listed_unit_price)
  where status = 'active';

create index idx_marketplace_purchases_buyer_created_at
  on greyline_be.marketplace_purchases(buyer_account_id, created_at desc);

create index idx_marketplace_purchases_seller_created_at
  on greyline_be.marketplace_purchases(seller_account_id, created_at desc);
