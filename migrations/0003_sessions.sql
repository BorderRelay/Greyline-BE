create table greyline_be.account_sessions (
  id                 uuid        primary key,
  account_id         uuid        not null references greyline_be.accounts(id) on delete cascade,
  refresh_token_hash text        not null unique,
  user_agent         text,
  ip_address         inet,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz not null default now()
);

create index idx_account_sessions_account_id
  on greyline_be.account_sessions(account_id);

create index idx_account_sessions_expires_at
  on greyline_be.account_sessions(expires_at);
