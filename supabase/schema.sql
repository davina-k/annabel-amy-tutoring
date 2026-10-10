-- ===========================================================================
--  Annabel and Amy's Maths Tutoring — Supabase schema
--  ---------------------------------------------------------------------------
--  Run this once in the Supabase dashboard: SQL Editor → New query → paste →
--  Run. It creates the three tables the site uses, locks them down with row
--  level security, and adds the booking function the front end calls.
--
--  The security model in one line: the public can READ free slots and WRITE
--  enquiries, and can do nothing else. Bookings are only ever created through
--  the `book_slot` function, which checks the slot is genuinely still free.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.slots (
  id               uuid primary key default gen_random_uuid(),
  tutor            text        not null check (tutor in ('Annabel', 'Amy')),
  starts_at        timestamptz not null,
  duration_minutes int         not null default 60 check (duration_minutes between 15 and 240),
  status           text        not null default 'available'
                     check (status in ('available', 'held', 'booked', 'cancelled')),
  created_at       timestamptz not null default now(),
  unique (tutor, starts_at)
);

create index if not exists slots_open_idx
  on public.slots (starts_at)
  where status = 'available';

create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  slot_id        uuid not null references public.slots (id) on delete cascade,
  contact_name   text not null check (char_length(contact_name)  between 1 and 120),
  contact_email  text not null check (char_length(contact_email) between 3 and 200),
  student_name   text not null check (char_length(student_name)  between 1 and 120),
  level          text not null check (char_length(level)         between 1 and 60),
  notes          text          check (notes is null or char_length(notes) <= 2000),
  status         text not null default 'requested'
                   check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  created_at     timestamptz not null default now()
);

create index if not exists bookings_slot_idx on public.bookings (slot_id);

create table if not exists public.enquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name)    between 1 and 120),
  email      text not null check (char_length(email)   between 3 and 200),
  phone      text          check (phone is null or char_length(phone) <= 40),
  level      text          check (level is null or char_length(level) <= 60),
  message    text not null check (char_length(message) between 1 and 4000),
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.slots     enable row level security;
alter table public.bookings  enable row level security;
alter table public.enquiries enable row level security;

-- Anyone may see slots that are still free. Nothing else about slots is
-- public, and nobody anonymous may change them.
drop policy if exists "public reads free slots" on public.slots;
create policy "public reads free slots"
  on public.slots for select
  to anon, authenticated
  using (status = 'available');

-- Anyone may leave an enquiry. Nobody anonymous may read them back.
drop policy if exists "public submits enquiries" on public.enquiries;
create policy "public submits enquiries"
  on public.enquiries for insert
  to anon, authenticated
  with check (true);

-- public.bookings deliberately has NO policies: with RLS on, that means no
-- anonymous access of any kind. Rows get in only via book_slot() below, and
-- you read them in the Supabase dashboard (or from a signed-in admin view).

-- ---------------------------------------------------------------------------
-- Booking function
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER lets this run with the owner's rights, so it can write to
-- `bookings` even though the caller cannot. It takes a row lock on the slot,
-- so two people clicking the same time at once cannot both succeed.

create or replace function public.book_slot(
  p_slot_id       uuid,
  p_contact_name  text,
  p_contact_email text,
  p_student_name  text,
  p_level         text,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot    public.slots%rowtype;
  v_booking uuid;
begin
  -- Reject obvious junk before touching anything.
  if p_contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;
  if char_length(coalesce(p_contact_name, ''))  = 0
     or char_length(coalesce(p_student_name, '')) = 0
     or char_length(coalesce(p_level, ''))        = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_fields');
  end if;
  if char_length(coalesce(p_notes, '')) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'notes_too_long');
  end if;

  -- Claim the slot, or fail cleanly if someone else got there first.
  select * into v_slot
  from public.slots
  where id = p_slot_id
    and status = 'available'
    and starts_at > now()
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_unavailable');
  end if;

  update public.slots set status = 'held' where id = v_slot.id;

  insert into public.bookings (
    slot_id, contact_name, contact_email, student_name, level, notes
  ) values (
    v_slot.id,
    left(trim(p_contact_name),  120),
    left(trim(p_contact_email), 200),
    left(trim(p_student_name),  120),
    left(trim(p_level),          60),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_booking;

  return jsonb_build_object('ok', true, 'booking_id', v_booking);
end;
$$;

revoke all on function public.book_slot(uuid, text, text, text, text, text) from public;
grant execute on function public.book_slot(uuid, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helper: fill the timetable with a recurring weekly pattern
-- ---------------------------------------------------------------------------
-- Example — give Annabel 16:00, 17:00 and 18:00 every Monday for 8 weeks:
--
--   select public.add_weekly_slots('Annabel', 1, array['16:00','17:00','18:00'], 8);
--
-- day_of_week follows ISO: 1 = Monday … 7 = Sunday.
-- Times are interpreted in Europe/London, so they follow BST automatically.

create or replace function public.add_weekly_slots(
  p_tutor       text,
  p_day_of_week int,
  p_times       text[],
  p_weeks       int default 8
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date    date;
  v_time    text;
  v_week    int;
  v_created int := 0;
begin
  v_date := current_date + ((p_day_of_week - extract(isodow from current_date)::int + 7) % 7);

  for v_week in 0 .. p_weeks - 1 loop
    foreach v_time in array p_times loop
      insert into public.slots (tutor, starts_at)
      values (
        p_tutor,
        ((v_date + (v_week * 7)) || ' ' || v_time)::timestamp at time zone 'Europe/London'
      )
      on conflict (tutor, starts_at) do nothing;
      v_created := v_created + 1;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.add_weekly_slots(text, int, text[], int) from public;
-- Deliberately NOT granted to anon: run it from the SQL editor only.

-- ---------------------------------------------------------------------------
-- Handy views for you (visible in the dashboard, not to the public)
-- ---------------------------------------------------------------------------

create or replace view public.booking_inbox as
  select b.created_at,
         b.status,
         s.tutor,
         s.starts_at,
         b.student_name,
         b.level,
         b.contact_name,
         b.contact_email,
         b.notes,
         b.id as booking_id,
         s.id as slot_id
  from public.bookings b
  join public.slots s on s.id = b.slot_id
  order by s.starts_at;

revoke all on public.booking_inbox from anon, authenticated;
