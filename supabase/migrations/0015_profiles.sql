-- Connexion par nom d'utilisateur (comme dans l'app) : Supabase Auth n'authentifie que par e-mail, donc on garde
-- la correspondance nom d'utilisateur -> compte ici, et c'est l'Edge Function login-with-username qui fait la
-- résolution + la connexion côté serveur — le nom d'utilisateur saisi par l'acheteur ne "voit" jamais son e-mail.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
-- Seule la personne elle-même peut lire son propre nom d'utilisateur (pour l'afficher) ; personne ne peut lire
-- celui d'un autre compte. La résolution nom -> compte pour la connexion passe par l'Edge Function (clé de
-- service), jamais par une lecture directe de cette table.
create policy "users read their own profile" on profiles for select using (id = auth.uid());

-- Appelée juste après supabase.auth.signUp() (le compte existe déjà à ce stade, avec ou sans session active selon
-- que la confirmation d'e-mail est exigée) : associe le nom d'utilisateur choisi à ce compte tout neuf.
create or replace function create_profile(p_user_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_username is null or length(trim(p_username)) < 3 then
    raise exception 'invalid_username';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user_not_found';
  end if;
  insert into profiles (id, username) values (p_user_id, lower(trim(p_username)));
end;
$$;

grant execute on function create_profile(uuid, text) to anon, authenticated;
