\set ON_ERROR_STOP on

begin;

do $$
declare
  money_cols integer;
  forced_rls integer;
begin
  select count(*) into money_cols
  from information_schema.columns
  where table_schema = 'public'
    and column_name like '%_sen'
    and data_type = 'bigint';
  if money_cols < 6 then
    raise exception 'expected bigint money columns, found %', money_cols;
  end if;

  select count(*) into forced_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'organizations',
      'memberships',
      'units',
      'tenants',
      'leases',
      'invoices',
      'payments',
      'payment_allocations',
      'gateway_bills',
      'audit_log'
    )
    and c.relrowsecurity
    and c.relforcerowsecurity;
  if forced_rls <> 10 then
    raise exception 'expected forced RLS on 10 tables, found %', forced_rls;
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'payment-slips' and public = false
  ) then
    raise exception 'payment-slips bucket missing or public';
  end if;
end $$;

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'manager-a@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'manager-b@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'tenant-a@example.com');

insert into public.organizations (id, name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Org A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Org B');

insert into public.memberships (user_id, org_id, role)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manager'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'manager');

insert into public.units (id, org_id, name)
values
  ('abababab-abab-4aba-8aba-abababababab', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A-1'),
  ('bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B-1');

insert into public.tenants (id, org_id, user_id, full_name, email, phone)
values (
  'adadadad-adad-4ada-8ada-adadadadadad',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333',
  'Tenant A',
  'tenant-a@example.com',
  '010'
);

insert into public.leases (
  id, org_id, unit_id, tenant_id, start_date, end_date, monthly_rent_sen, deposit_sen
) values (
  'aeaeaeae-aeae-4aea-8aea-aeaeaeaeaeae',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'abababab-abab-4aba-8aba-abababababab',
  'adadadad-adad-4ada-8ada-adadadadadad',
  date '2026-01-31',
  date '2026-07-15',
  150000,
  300000
);

insert into public.invoices (
  id, org_id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen
) values (
  'afafafaf-afaf-4afa-8afa-afafafafafaf',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aeaeaeae-aeae-4aea-8aea-aeaeaeaeaeae',
  'deposit',
  null,
  null,
  null,
  date '2026-01-31',
  300000
);

insert into public.audit_log (org_id, actor_id, action, entity_id, details)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'lease.created',
  'aeaeaeae-aeae-4aea-8aea-aeaeaeaeaeae',
  '{}'::jsonb
);

-- Manager A sees own org only
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'manager A should see one organization';
  end if;
  if (select count(*) from public.leases) <> 1 then
    raise exception 'manager A should see own lease';
  end if;
  if (select count(*) from public.audit_log) <> 1 then
    raise exception 'manager A should read audit_log';
  end if;
end $$;

-- Manager B cannot see Org A
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'manager B should see only own organization';
  end if;
  if exists (
    select 1 from public.leases
    where id = 'aeaeaeae-aeae-4aea-8aea-aeaeaeaeaeae'
  ) then
    raise exception 'manager B can see org A lease';
  end if;
  if (select count(*) from public.audit_log) <> 0 then
    raise exception 'manager B can see org A audit log';
  end if;
end $$;

do $$
begin
  insert into public.units (org_id, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stolen');
  raise exception 'authenticated insert into units should fail';
exception
  when insufficient_privilege then
    null;
end $$;

-- Tenant can update own phone only
reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
set local role authenticated;

update public.tenants
set phone = '011-222'
where id = 'adadadad-adad-4ada-8ada-adadadadadad';

do $$
begin
  if (select phone from public.tenants where id = 'adadadad-adad-4ada-8ada-adadadadadad') <> '011-222' then
    raise exception 'tenant phone update failed';
  end if;
end $$;

do $$
begin
  update public.tenants
  set full_name = 'Hacked'
  where id = 'adadadad-adad-4ada-8ada-adadadadadad';
  raise exception 'tenant full_name update should fail';
exception
  when others then
    if sqlerrm not like '%tenants may only update phone%'
       and sqlstate <> '42501' then
      raise;
    end if;
end $$;

-- Anon has no access
reset role;
set local role anon;

do $$
begin
  perform count(*) from public.organizations;
  raise exception 'anon should not select organizations';
exception
  when insufficient_privilege then
    null;
end $$;

-- audit_log append-only for the database owner
reset role;

do $$
begin
  update public.audit_log set action = 'tampered';
  raise exception 'audit_log update should fail for owner';
exception
  when others then
    if sqlerrm not like '%append-only%' then
      raise;
    end if;
end $$;

do $$
begin
  delete from public.audit_log;
  raise exception 'audit_log delete should fail for owner';
exception
  when others then
    if sqlerrm not like '%append-only%' then
      raise;
    end if;
end $$;

do $$
begin
  truncate public.audit_log;
  raise exception 'audit_log truncate should fail for owner';
exception
  when others then
    if sqlerrm not like '%append-only%' then
      raise;
    end if;
end $$;

rollback;

select 'schema and access checks passed' as result;
