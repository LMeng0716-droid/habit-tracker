-- READ ONLY. Run only after v3-review confirms the base tables exist.
-- Save results securely BEFORE and immediately AFTER the approved migration.
-- These two hashes ignore new columns; all original identities/data/times must match.
select count(*) habit_rows,
 md5(coalesce(jsonb_agg(jsonb_build_array(user_id,id,name,color,created_date,archived_on,created_at at time zone 'UTC') order by user_id,id)::text,'[]')) old_habit_hash
from habit_mobile.habits;
select count(*) checkin_rows,
 md5(coalesce(jsonb_agg(jsonb_build_array(user_id,habit_id,date,created_at at time zone 'UTC') order by user_id,habit_id,date)::text,'[]')) old_checkin_hash
from habit_mobile.habit_checkins c;
select count(*) unexpected_historical_dates from habit_mobile.habit_checkins c
join habit_mobile.habits h on h.user_id=c.user_id and h.id=c.habit_id
where c.date<h.created_date or c.date>(statement_timestamp() at time zone 'Asia/Shanghai')::date or (h.archived_on is not null and c.date>h.archived_on);
-- Output post-install verification only if the extension exists; run emitted SQL
-- after review. Do not execute this against a partial/unapproved schema blindly.
select 'select count(*) from habit_mobile.progress_operations;' as after_only_check
where to_regclass('habit_mobile.progress_operations') is not null;
select 'select count(*) from habit_mobile.habits where emoji<>''🌱'' or habit_type<>''boolean'' or target<>1 or unit<>''completion'' or sort_order<>0;' as immediate_after_defaults_check
where exists(select 1 from information_schema.columns where table_schema='habit_mobile' and table_name='habits' and column_name='emoji');
