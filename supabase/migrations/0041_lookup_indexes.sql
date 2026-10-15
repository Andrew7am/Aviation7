-- 0041 lookup indexes: the columns every import, sync and check searches on.
--
-- An import looks its rows up by ticket number; the Airtable sync, every two
-- minutes, by ticket number and PNR; the screen reads the activity log by
-- kind of change. None of them had an index, so each was a scan of the whole
-- table (6,100 tickets, 22,000 log rows) - small now, and the reason the
-- system slows as both grow.

set search_path = public;

create index if not exists tickets_ticket_no_idx on tickets (ticket_no);
create index if not exists tickets_pnr_idx       on tickets (pnr) where pnr is not null and pnr <> '';
create index if not exists tickets_req_num_idx   on tickets (req_num) where req_num is not null and req_num <> '';
create index if not exists audit_log_action_idx  on audit_log (action, performed_at);
create index if not exists pending_tickets_ticket_idx on pending_tickets (ticket_no) where state = 'PENDING';
