create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null unique,
  amount integer not null default 1 check (amount = 1),
  appointment_date date not null,
  time_slot text not null,
  agency text not null,
  topic text not null,
  department text not null,
  receiver_name text not null default '',
  status text not null default 'รอตอบรับ',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists bookings_unique_active_slot
  on public.bookings (appointment_date, department, time_slot)
  where status <> 'ยกเลิก';

create or replace function public.set_booking_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists bookings_set_updated_at on public.bookings;

create trigger bookings_set_updated_at
before update on public.bookings
for each row
execute procedure public.set_booking_updated_at();
