-- Local disposable PostgreSQL ONLY. NOT for Supabase SQL Editor.
-- Minimal Auth model to exercise SQL/RLS; does not simulate JWT verification,
-- PostgREST, GoTrue, email flows, or Supabase function execution roles.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
