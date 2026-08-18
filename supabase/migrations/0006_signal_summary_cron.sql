-- North · signal summary · weekly cron trigger (DEC-07)
-- Calls the signal-summary Edge Function via pg_net on Sundays at 09:00 UTC
-- (= 05:00 AST Sunday), after the daily score job for Sunday has finished.
--
-- Setup (operator, one-off per environment) — see docs/north-core-metrics-spec.md
-- "Operator runbook" appendix for details:
--
--   alter database postgres set app.functions_url = 'http://127.0.0.1:54321/functions/v1';
--   -- (or the project's hosted edge functions URL)
--   alter database postgres set app.summary_trigger_secret = '<random hex>';
--   supabase secrets set DEEPSEEK_API_KEY=sk-...
--   supabase secrets set SUMMARY_TRIGGER_SECRET=<same value as app.summary_trigger_secret>
--   supabase functions deploy signal-summary

create or replace function public.trigger_signal_summary_job()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    functions_url text;
    trigger_secret text;
begin
    functions_url := current_setting('app.functions_url', true);
    trigger_secret := current_setting('app.summary_trigger_secret', true);

    if functions_url is null or trigger_secret is null then
        raise notice
            'signal-summary trigger skipped: app.functions_url or app.summary_trigger_secret not set';
        return;
    end if;

    perform net.http_post(
        url := functions_url || '/signal-summary',
        headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-trigger-secret', trigger_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
end;
$$;

-- Weekly cron: Sunday 09:00 UTC. Idempotent re-registration.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'signal-summary-weekly') then
        perform cron.unschedule('signal-summary-weekly');
    end if;
end $$;

select cron.schedule(
    'signal-summary-weekly',
    '0 9 * * 0',
    $$select public.trigger_signal_summary_job()$$
);
