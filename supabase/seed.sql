insert into public.universities (name, short_name)
values ('성신여자대학교', '성신여대'), ('덕성여자대학교', '덕성여대'), ('한성대학교', '한성대')
on conflict (name) do nothing;

-- No real student email domains are pre-approved. An operator verifies student eligibility before adding them.
