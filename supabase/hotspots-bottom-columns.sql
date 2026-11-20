alter table public.hotspots
  add column if not exists depth_ft    real,
  add column if not exists slope_ft_nm real,
  add column if not exists current_kt  real;

notify pgrst, 'reload schema';
