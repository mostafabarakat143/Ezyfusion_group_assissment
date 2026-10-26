-- Rent collection schema from TASK.md section 8.
-- Money is integer sen (bigint). Calendar dates are date. Instants are timestamptz.
-- Rebuild with: npx supabase db reset

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.membership_role as enum ('manager', 'staff');
create type public.invoice_kind as enum ('deposit', 'rent');
create type public.payment_method as enum ('cash', 'bank_transfer', 'online');
create type public.payment_status as enum (
  'pending_verification',
  'approved',
  'rejected',
  'voided'
);
create type public.gateway_bill_status as enum ('pending', 'paid', 'failed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint organizations_name_check check (char_length(btrim(name)) > 0)
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id),
  -- A staff member or manager belongs to exactly one organization.
  constraint memberships_user_id_key unique (user_id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint units_name_check check (char_length(btrim(name)) > 0),
  constraint units_org_id_key unique (org_id, id),
  constraint units_org_name_key unique (org_id, name)
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_full_name_check check (char_length(btrim(full_name)) > 0),
  constraint tenants_email_check check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and position('@' in email) > 1
  ),
  constraint tenants_phone_check check (
    phone is null
    or (
      phone = btrim(phone)
      and char_length(phone) between 3 and 32
    )
  ),
  constraint tenants_org_id_key unique (org_id, id),
  constraint tenants_user_id_key unique (user_id),
  constraint tenants_org_email_key unique (org_id, email)
);

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  unit_id uuid not null,
  tenant_id uuid not null,
  start_date date not null,
  end_date date not null,
  monthly_rent_sen bigint not null,
  deposit_sen bigint not null,
  created_at timestamptz not null default now(),
  constraint leases_dates_check check (end_date >= start_date),
  constraint leases_rent_check check (monthly_rent_sen > 0),
  constraint leases_deposit_check check (deposit_sen >= 0),
  constraint leases_org_id_key unique (org_id, id),
  constraint leases_unit_fkey
    foreign key (org_id, unit_id)
    references public.units (org_id, id)
    on delete restrict,
  constraint leases_tenant_fkey
    foreign key (org_id, tenant_id)
    references public.tenants (org_id, id)
    on delete restrict,
  constraint leases_unit_no_overlap
    exclude using gist (
      unit_id with =,
      daterange(start_date, end_date, '[]') with &&
    )
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lease_id uuid not null,
  kind public.invoice_kind not null,
  period_index integer,
  period_start date,
  period_end date,
  due_date date not null,
  amount_sen bigint not null,
  created_at timestamptz not null default now(),
  constraint invoices_amount_check check (amount_sen >= 0),
  constraint invoices_period_index_check check (
    period_index is null or period_index >= 0
  ),
  constraint invoices_kind_shape_check check (
    (
      kind = 'deposit'
      and period_index is null
      and period_start is null
      and period_end is null
    )
    or (
      kind = 'rent'
      and period_index is not null
      and period_start is not null
      and period_end is not null
      and period_end >= period_start
    )
  ),
  constraint invoices_org_id_key unique (org_id, id),
  constraint invoices_lease_period_key unique nulls not distinct (lease_id, kind, period_index),
  constraint invoices_lease_fkey
    foreign key (org_id, lease_id)
    references public.leases (org_id, id)
    on delete cascade
);

create table public.gateway_bills (
  id text primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  lease_id uuid not null,
  amount_sen bigint not null,
  status public.gateway_bill_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gateway_bills_id_check check (char_length(id) >= 16),
  constraint gateway_bills_amount_check check (amount_sen > 0),
  constraint gateway_bills_org_id_key unique (org_id, id),
  constraint gateway_bills_lease_fkey
    foreign key (org_id, lease_id)
    references public.leases (org_id, id)
    on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lease_id uuid not null,
  amount_sen bigint not null,
  unapplied_sen bigint not null default 0,
  method public.payment_method not null,
  status public.payment_status not null,
  received_at timestamptz not null,
  slip_path text,
  gateway_bill_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_check check (amount_sen > 0),
  constraint payments_unapplied_check check (
    unapplied_sen >= 0 and unapplied_sen <= amount_sen
  ),
  constraint payments_slip_check check (
    (method = 'bank_transfer' and slip_path is not null)
    or (method <> 'bank_transfer' and slip_path is null)
  ),
  constraint payments_gateway_check check (
    (method = 'online' and gateway_bill_id is not null)
    or (method <> 'online' and gateway_bill_id is null)
  ),
  constraint payments_slip_path_org_check check (
    slip_path is null
    or slip_path like (org_id::text || '/%')
  ),
  constraint payments_org_id_key unique (org_id, id),
  constraint payments_gateway_bill_id_key unique (gateway_bill_id),
  -- Matches Prisma's one-to-one relation on (org_id, gateway_bill_id); redundant
  -- with gateway_bill_id uniqueness when that column is non-null.
  constraint payments_org_gateway_bill_key unique (org_id, gateway_bill_id),
  constraint payments_lease_fkey
    foreign key (org_id, lease_id)
    references public.leases (org_id, id)
    on delete restrict,
  constraint payments_gateway_bill_fkey
    foreign key (org_id, gateway_bill_id)
    references public.gateway_bills (org_id, id)
    on delete restrict
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_sen bigint not null,
  created_at timestamptz not null default now(),
  constraint payment_allocations_amount_check check (amount_sen > 0),
  constraint payment_allocations_org_id_key unique (org_id, id),
  constraint payment_allocations_payment_invoice_key unique (payment_id, invoice_id),
  constraint payment_allocations_payment_fkey
    foreign key (org_id, payment_id)
    references public.payments (org_id, id)
    on delete cascade,
  constraint payment_allocations_invoice_fkey
    foreign key (org_id, invoice_id)
    references public.invoices (org_id, id)
    on delete restrict
);

-- org_id is not a FK: ON DELETE CASCADE / TRUNCATE CASCADE would erase history.
-- Append-only rules (below) apply to the database owner and service role too.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_action_check check (char_length(btrim(action)) > 0),
  constraint audit_log_entity_id_check check (char_length(btrim(entity_id)) > 0)
);

create index memberships_org_id_idx on public.memberships (org_id);
create index units_org_id_idx on public.units (org_id);
create index tenants_org_id_idx on public.tenants (org_id);
create index leases_org_id_idx on public.leases (org_id);
create index leases_unit_id_idx on public.leases (unit_id);
create index leases_tenant_id_idx on public.leases (tenant_id);
create index invoices_org_id_idx on public.invoices (org_id);
create index invoices_lease_id_idx on public.invoices (lease_id);
create index invoices_due_date_idx on public.invoices (org_id, due_date);
create index payments_org_id_idx on public.payments (org_id);
create index payments_lease_id_idx on public.payments (lease_id);
create index payments_received_at_idx on public.payments (org_id, received_at);
create index payment_allocations_org_id_idx on public.payment_allocations (org_id);
create index payment_allocations_payment_id_idx on public.payment_allocations (payment_id);
create index payment_allocations_invoice_id_idx on public.payment_allocations (invoice_id);
create index gateway_bills_org_id_idx on public.gateway_bills (org_id);
create index gateway_bills_lease_id_idx on public.gateway_bills (lease_id);
create index audit_log_org_id_idx on public.audit_log (org_id);
create index audit_log_created_at_idx on public.audit_log (org_id, created_at);

comment on column public.leases.monthly_rent_sen is 'Monthly rent in Malaysian sen.';
comment on column public.leases.deposit_sen is 'Deposit in Malaysian sen.';
comment on column public.invoices.amount_sen is 'Invoice amount in Malaysian sen.';
comment on column public.payments.amount_sen is 'Payment amount in Malaysian sen.';
comment on column public.payments.unapplied_sen is 'Approved amount not allocated to invoices.';
comment on column public.payment_allocations.amount_sen is 'Allocated amount in Malaysian sen.';
comment on column public.gateway_bills.amount_sen is 'Gateway bill amount in Malaysian sen.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.forbid_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create or replace function public.tenants_phone_only_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.org_id is distinct from old.org_id
    or new.user_id is distinct from old.user_id
    or new.full_name is distinct from old.full_name
    or new.email is distinct from old.email
    or new.created_at is distinct from old.created_at
  then
    raise exception 'tenants may only update phone';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.memberships
  where user_id = auth.uid()
  union
  select org_id
  from public.tenants
  where user_id = auth.uid();
$$;

create or replace function public.current_membership_role()
returns public.membership_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.memberships
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and role = 'manager'
  );
$$;

create or replace function public.is_staff_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
  );
$$;

create or replace function public.is_tenant()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenants
    where user_id = auth.uid()
  );
$$;

create or replace function public.tenant_lease_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leases l
  join public.tenants t on t.id = l.tenant_id
  where t.user_id = auth.uid();
$$;

create trigger audit_log_append_only
before update or delete on public.audit_log
for each row execute function public.forbid_audit_log_mutation();

-- TRUNCATE does not fire row DELETE triggers; block it explicitly (incl. owner).
create trigger audit_log_forbid_truncate
before truncate on public.audit_log
for each statement execute function public.forbid_audit_log_mutation();

revoke truncate on public.audit_log from public;
revoke truncate on public.audit_log from anon, authenticated, service_role;

create trigger tenants_phone_only_update
before update on public.tenants
for each row execute function public.tenants_phone_only_update();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills enable row level security;
alter table public.audit_log enable row level security;

alter table public.organizations force row level security;
alter table public.memberships force row level security;
alter table public.units force row level security;
alter table public.tenants force row level security;
alter table public.leases force row level security;
alter table public.invoices force row level security;
alter table public.payments force row level security;
alter table public.payment_allocations force row level security;
alter table public.gateway_bills force row level security;
alter table public.audit_log force row level security;

-- organizations: members and tenants read their own organization
create policy organizations_select on public.organizations
for select to authenticated
using (id in (select public.current_org_ids()));

-- memberships: staff/manager read own organization; tenants none
create policy memberships_select on public.memberships
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

-- units: staff/manager read org; tenants read units of own leases
create policy units_select_staff on public.units
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy units_select_tenant on public.units
for select to authenticated
using (
  public.is_tenant()
  and id in (
    select l.unit_id
    from public.leases l
    where l.id in (select public.tenant_lease_ids())
  )
);

-- tenants: staff/manager read org; tenant reads and updates own phone only
create policy tenants_select_staff on public.tenants
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy tenants_select_own on public.tenants
for select to authenticated
using (user_id = auth.uid());

create policy tenants_update_own_phone on public.tenants
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- leases / invoices / payments / allocations / gateway_bills
create policy leases_select_staff on public.leases
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy leases_select_tenant on public.leases
for select to authenticated
using (id in (select public.tenant_lease_ids()));

create policy invoices_select_staff on public.invoices
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy invoices_select_tenant on public.invoices
for select to authenticated
using (lease_id in (select public.tenant_lease_ids()));

create policy payments_select_staff on public.payments
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy payments_select_tenant on public.payments
for select to authenticated
using (lease_id in (select public.tenant_lease_ids()));

create policy payment_allocations_select_staff on public.payment_allocations
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy payment_allocations_select_tenant on public.payment_allocations
for select to authenticated
using (
  payment_id in (
    select p.id
    from public.payments p
    where p.lease_id in (select public.tenant_lease_ids())
  )
);

create policy gateway_bills_select_staff on public.gateway_bills
for select to authenticated
using (
  public.is_staff_or_manager()
  and org_id in (select public.current_org_ids())
);

create policy gateway_bills_select_tenant on public.gateway_bills
for select to authenticated
using (lease_id in (select public.tenant_lease_ids()));

-- audit_log: managers only
create policy audit_log_select_manager on public.audit_log
for select to authenticated
using (
  public.is_manager()
  and org_id in (select public.current_org_ids())
);

-- ---------------------------------------------------------------------------
-- Grants: Data API may only read (and tenants may update phone).
-- Server writes go through Prisma as the database owner / service role.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
-- PUBLIC retains EXECUTE by default; strip it so /rest/v1/rpc/... cannot call helpers
-- (or future functions) without an explicit grant.
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on schema public from public, anon;

alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke all on tables from public;
alter default privileges in schema public
  revoke all on sequences from public;

grant usage on schema public to authenticated;

grant select on
  public.organizations,
  public.memberships,
  public.units,
  public.tenants,
  public.leases,
  public.invoices,
  public.payments,
  public.payment_allocations,
  public.gateway_bills,
  public.audit_log
to authenticated;

grant update (phone) on public.tenants to authenticated;

grant execute on function public.current_org_ids() to authenticated;
grant execute on function public.current_membership_role() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_staff_or_manager() to authenticated;
grant execute on function public.is_tenant() to authenticated;
grant execute on function public.tenant_lease_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private payment-slips bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.payment_slip_org_id(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$;

-- No SELECT for authenticated users: staff/managers read only via short-lived
-- signed URLs minted by the server with the service role (GET /api/payments/:id/slip).
-- INSERT/DELETE remain so staff can upload slips and clean up failed recordings.

create policy payment_slips_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payment-slips'
  and public.is_staff_or_manager()
  and public.payment_slip_org_id(name) in (select public.current_org_ids())
);

create policy payment_slips_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'payment-slips'
  and public.is_staff_or_manager()
  and public.payment_slip_org_id(name) in (select public.current_org_ids())
);

revoke all on function public.payment_slip_org_id(text) from public, anon, authenticated;
grant execute on function public.payment_slip_org_id(text) to authenticated;
