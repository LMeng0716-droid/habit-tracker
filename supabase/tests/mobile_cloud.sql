\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
create function pg_temp.assert(p boolean,msg text) returns void language plpgsql as $$ begin if p is not true then raise exception 'FAIL: %',msg; end if; end $$;
set local role anon;
do $$ begin
  begin perform habit_mobile.read_snapshot(); raise exception 'FAIL anon'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform habit_mobile.read_snapshot(); raise exception 'FAIL nil uid'; exception when insufficient_privilege then null; end;
  begin perform habit_mobile.create_habit('no','no',0); raise exception 'FAIL nil uid write'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select habit_mobile.create_habit('reading','阅读',0);
select habit_mobile.create_habit('reading','阅读',0);
select pg_temp.assert((select count(*) from habit_mobile.habits)=1,'creation retry unique');
select habit_mobile.edit_habit('reading','阅读十分钟',1);
select habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
select habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
select pg_temp.assert((select count(*) from habit_mobile.habit_checkins)=1,'checkin uniqueness/retry');
select habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,false);
select habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,false);
select pg_temp.assert((select count(*) from habit_mobile.habit_checkins)=0,'cancel retry');
do $$ begin
  begin perform habit_mobile.set_checkin('reading',((clock_timestamp() at time zone 'Asia/Shanghai')::date+1),true); raise exception 'FAIL future'; exception when others then if sqlerrm<>'date_not_eligible' then raise; end if; end;
  begin insert into habit_mobile.habit_checkins(habit_id,date) values('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date-1); raise exception 'FAIL direct before creation'; exception when others then if sqlerrm<>'date_not_eligible' then raise; end if; end;
  begin update habit_mobile.habits set created_date=current_date-5; raise exception 'FAIL immutable column'; exception when insufficient_privilege then null; end;
  begin update habit_mobile.habits set user_id='00000000-0000-0000-0000-000000000002'; raise exception 'FAIL reassignment'; exception when insufficient_privilege then null; end;
  begin delete from habit_mobile.habits; raise exception 'FAIL habit deletion'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.assert((select user_id=auth.uid() and created_date=(clock_timestamp() at time zone 'Asia/Shanghai')::date and created_at is not null from habit_mobile.habits where id='reading'),'identity/date/time defaults under column grants');
-- B cannot see/edit/check in A's habit. Same text ID is independent per user.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert(jsonb_array_length(habit_mobile.read_snapshot()->'habits')=0,'B cannot read A');
do $$ begin
  begin perform habit_mobile.archive_habit('reading'); raise exception 'FAIL cross user archive'; exception when others then if sqlerrm<>'habit_not_found' then raise; end if; end;
  begin perform habit_mobile.edit_habit('reading','attack',0); raise exception 'FAIL cross user update'; exception when others then if sqlerrm<>'habit_not_found' then raise; end if; end;
  begin perform habit_mobile.set_checkin('reading',current_date,true); raise exception 'FAIL cross user checkin'; exception when others then if sqlerrm<>'habit_not_found' then raise; end if; end;
  begin insert into habit_mobile.habits(user_id,id,name,color) values('00000000-0000-0000-0000-000000000001','forged','forged',0); raise exception 'FAIL forged owner'; exception when insufficient_privilege then null; end;
end $$;
select habit_mobile.create_habit('reading','B的习惯',2);
select habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((habit_mobile.read_snapshot()->'habits'->0->>'name')='阅读十分钟','A still owns independent habit');
select pg_temp.assert((select count(*) from habit_mobile.habit_checkins)=0,'A cannot read B checkins');
delete from habit_mobile.habit_checkins where habit_id='reading';
-- Failed multi-statement transaction rolls back an earlier successful checkin.
do $$ begin
  begin
    perform habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
    perform habit_mobile.edit_habit('reading','',0);
    raise exception 'FAIL expected CHECK';
  exception when check_violation then null;
  end;
  perform pg_temp.assert((select count(*) from habit_mobile.habit_checkins)=0,'transaction rollback');
end $$;
select habit_mobile.set_checkin('reading',(clock_timestamp() at time zone 'Asia/Shanghai')::date,true);
select habit_mobile.archive_habit('reading');
select habit_mobile.archive_habit('reading');
select pg_temp.assert((select count(*) from habit_mobile.habit_checkins)=1,'archive preserves today history');
do $$ begin
  begin perform habit_mobile.set_checkin('reading',current_date,false); raise exception 'FAIL archived cancel'; exception when others then if sqlerrm<>'habit_archived' then raise; end if; end;
  begin update habit_mobile.habits set archived_on=null where id='reading'; raise exception 'FAIL unarchive'; exception when others then if sqlerrm<>'habit_archived' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert((select count(*) from habit_mobile.habit_checkins)=1,'A cancellation did not touch B');
reset role;
-- PG17 accepts the old mixed syntax too; retain a regression probe rather
-- than attributing a syntax error that was not reproduced. Rolls back below.
set local role managed_migration_admin;
grant insert(habit_id,date),delete on habit_mobile.habit_checkins to authenticated;
reset role;
select pg_temp.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='habit_mobile' and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false) or has_function_privilege('anon',p.oid,'EXECUTE'))),'all functions invoker, safe path, anon denied');
select pg_temp.assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)),'all tables FORCE RLS');
do $$ begin
  if to_regclass('habit_api.audit_sentinel') is not null then
    perform pg_temp.assert((select count(*) from habit_api.audit_sentinel)=1,'existing partial initialization untouched');
  end if;
end $$;
select pg_temp.assert((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='habit_mobile' and c.relkind='r')=2,'exactly two business tables');
select pg_temp.assert(not has_table_privilege('authenticated','habit_mobile.habits','INSERT')
  and has_column_privilege('authenticated','habit_mobile.habits','id','INSERT')
  and has_column_privilege('authenticated','habit_mobile.habits','name','UPDATE')
  and not has_column_privilege('authenticated','habit_mobile.habits','user_id','INSERT')
  and not has_column_privilege('authenticated','habit_mobile.habits','created_date','UPDATE'), 'habit column grants remain minimal');
select pg_temp.assert(not has_table_privilege('authenticated','habit_mobile.habit_checkins','INSERT')
  and has_column_privilege('authenticated','habit_mobile.habit_checkins','habit_id','INSERT')
  and has_column_privilege('authenticated','habit_mobile.habit_checkins','date','INSERT')
  and not has_column_privilege('authenticated','habit_mobile.habit_checkins','user_id','INSERT')
  and not has_column_privilege('authenticated','habit_mobile.habit_checkins','created_at','INSERT')
  and has_table_privilege('authenticated','habit_mobile.habit_checkins','DELETE')
  and not has_table_privilege('authenticated','habit_mobile.habit_checkins','UPDATE'), 'checkin INSERT columns and DELETE grant');
select pg_temp.assert(not has_function_privilege('authenticated','habit_mobile.guard_habit()','EXECUTE')
  and not has_function_privilege('authenticated','habit_mobile.guard_checkin()','EXECUTE'), 'trigger execution needs no client EXECUTE grant');
rollback;
\echo 'PASS mobile RLS, identity isolation, unique retries, date guards, archive history, rollback and old schema preservation'
