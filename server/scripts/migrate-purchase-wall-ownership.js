import { pool } from '../src/db.js';

try {
  await pool.query(`
    alter table commerce_order_items
      add column if not exists reserved_wall_id uuid references walls(id) on delete set null;

    create unique index if not exists idx_commerce_order_items_reserved_wall
      on commerce_order_items(reserved_wall_id)
      where reserved_wall_id is not null;

    create or replace function saidhere_ensure_order_wall_assignments(p_order_id uuid)
    returns void
    language plpgsql
    as $$
    declare
      v_customer_id uuid;
      v_status text;
      v_wall_id uuid;
      v_existing_customer_id uuid;
      item record;
    begin
      select customer_id, status
        into v_customer_id, v_status
        from commerce_orders
       where id = p_order_id;

      if v_customer_id is null or v_status not in ('paid', 'fulfilled') then
        return;
      end if;

      for item in
        select i.id, i.ordinal, i.wall_id, i.reserved_wall_id, p.id as plaque_id
          from commerce_order_items i
          left join plaques p on p.order_item_id = i.id
         where i.order_id = p_order_id
         order by i.ordinal
         for update of i
      loop
        -- Already programmed: the programmed Wall is the purchased Wall.
        if item.wall_id is not null then
          v_wall_id := item.wall_id;
          update commerce_order_items
             set reserved_wall_id = item.wall_id
           where id = item.id
             and reserved_wall_id is distinct from item.wall_id;
        elsif item.reserved_wall_id is not null then
          -- Paid but not programmed yet: keep the existing reservation.
          v_wall_id := item.reserved_wall_id;
        else
          -- Payment has completed. Create the customer's Wall immediately, but
          -- leave wall_id null so fulfilment still correctly says Program NFC.
          insert into walls (slug, display_name, location_hint, active, setup_required)
          values (
            upper(substr(replace(item.id::text, '-', ''), 1, 12)),
            'Set up your Wall',
            '',
            true,
            true
          )
          returning id into v_wall_id;

          update commerce_order_items
             set reserved_wall_id = v_wall_id
           where id = item.id;
        end if;

        select customer_id
          into v_existing_customer_id
          from wall_ownerships
         where wall_id = v_wall_id
           and ended_at is null
         limit 1;

        if v_existing_customer_id is not null and v_existing_customer_id <> v_customer_id then
          raise exception 'Wall % is already assigned to another customer', v_wall_id;
        end if;

        if v_existing_customer_id is null then
          insert into wall_ownerships (customer_id, wall_id, order_id, plaque_id)
          values (v_customer_id, v_wall_id, p_order_id, item.plaque_id);
        elsif item.plaque_id is not null then
          update wall_ownerships
             set plaque_id = coalesce(plaque_id, item.plaque_id)
           where customer_id = v_customer_id
             and wall_id = v_wall_id
             and ended_at is null;
        end if;
      end loop;
    end;
    $$;

    create or replace function saidhere_assign_walls_after_payment()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.customer_id is not null and new.status in ('paid', 'fulfilled') then
        perform saidhere_ensure_order_wall_assignments(new.id);
      end if;
      return new;
    end;
    $$;

    drop trigger if exists trg_saidhere_assign_walls_after_order_insert on commerce_orders;
    create trigger trg_saidhere_assign_walls_after_order_insert
      after insert on commerce_orders
      for each row execute function saidhere_assign_walls_after_payment();

    drop trigger if exists trg_saidhere_assign_walls_after_payment on commerce_orders;
    create trigger trg_saidhere_assign_walls_after_payment
      after update of customer_id, status on commerce_orders
      for each row execute function saidhere_assign_walls_after_payment();

    create or replace function saidhere_replace_reserved_wall_after_programming()
    returns trigger
    language plpgsql
    as $$
    declare
      v_reserved uuid;
    begin
      v_reserved := old.reserved_wall_id;
      if new.wall_id is null or v_reserved is null or new.wall_id = v_reserved then
        return null;
      end if;

      -- The fulfilment flow has created the physical/programmed Wall and its
      -- ownership. End the temporary reservation atomically so the customer
      -- never sees two Walls for one purchase.
      update wall_ownerships
         set ended_at = coalesce(ended_at, now())
       where wall_id = v_reserved
         and ended_at is null;

      update commerce_order_items
         set reserved_wall_id = new.wall_id
       where id = new.id;

      -- Reserved Walls have no NFC, posts or visits. Delete them when untouched;
      -- otherwise retain them inactive rather than destroying unexpected data.
      update walls set active = false where id = v_reserved;
      delete from walls w
       where w.id = v_reserved
         and not exists (select 1 from wall_tags t where t.wall_id = w.id)
         and not exists (select 1 from wall_posts p where p.wall_id = w.id)
         and not exists (select 1 from wall_visits v where v.wall_id = w.id)
         and not exists (select 1 from plaques p where p.wall_id = w.id)
         and not exists (select 1 from admin_wall_assignments a where a.wall_id = w.id)
         and not exists (select 1 from admin_users u where u.wall_id = w.id);

      return null;
    end;
    $$;

    drop trigger if exists trg_saidhere_replace_reserved_wall_after_programming on commerce_order_items;
    create trigger trg_saidhere_replace_reserved_wall_after_programming
      after update of wall_id on commerce_order_items
      for each row execute function saidhere_replace_reserved_wall_after_programming();
  `);

  // Backfill existing paid orders that are already linked to a customer. This is
  // idempotent: programmed items use their current Wall; unprogrammed items get
  // one reservation and one ownership record.
  const orders = await pool.query(
    `select id
       from commerce_orders
      where customer_id is not null
        and status in ('paid', 'fulfilled')
      order by created_at`,
  );
  for (const order of orders.rows) {
    await pool.query(`select saidhere_ensure_order_wall_assignments($1)`, [order.id]);
  }

  console.log(`Purchase Wall ownership is up to date (${orders.rowCount} paid order(s) checked).`);
} finally {
  await pool.end();
}
