-- 0027: Shop UPI VPA (Virtual Payment Address) for collection pay-links.
-- A shop's UPI payee address, e.g. "shop@okhdfcbank". Used to build upi://pay
-- deep links inside payment reminders (parties collection flow, SALT-053).
-- Nullable: shops without a VPA simply omit the pay link from the reminder.
-- Run in the Supabase SQL editor after 0026.

alter table public.shops add column upi_vpa text;
