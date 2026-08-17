-- 残るもの。Supabase の SQL エディタで流す。
--
-- --- 方針 ---
-- 生の行を残して、合計は数え上げる。合計だけを持って加算していく形は単純だが、
-- 数え方にバグがあったときに合計が永久に汚れる。生の行があれば直して数え直せる。
-- 都度加算は、必要になってから batch として足す。
--
-- 書けるのはサーバーだけ。kills / deaths の権威はサーバーなので、クライアントに
-- 書かせる選択肢は無い (999 キルと名乗れる)。ただしサーバーが秘密鍵を持つのは
-- 今までに無い性質なので、渡す権限を最小にする — テーブルへの直接の書き込みは
-- 許さず、下の関数 1 本だけを呼べるようにする。

-- ============================================================
-- キャラ
-- ============================================================
--
-- **auth.users とは分ける。** 戦績を auth.users.id で持つと、発行元 (いまは
-- Supabase) の都合が主キーになる。認証を別の所へ移した瞬間に全部が宙に浮く。
-- src/auth/session.ts に「発行元の都合はここから外へ出さない」と書いてあるのと
-- 矛盾する。
--
-- MGO2 も User と Character が別だった。skill も戦績も見た目もキャラ単位。
-- いまはアカウントに 1 体だけ自動で作るので、画面の上では今と変わらない。
create table if not exists players (
  id           uuid primary key default gen_random_uuid(),
  -- いまの発行元での識別子。差し替えられるようにしておく
  auth_subject text unique not null,
  -- 表示名。**既定は発行元の名前だが、あとから変えられる**
  name         text not null,
  -- 見た目。部位ごとの選択。増えても列を足さずに済むよう jsonb
  --
  -- **飾りに徹する。** サーバーは headHeight で頭の高さを出して可視を決めて
  -- いるので、見た目が体の大きさを変えると描いている物と判定がずれる。
  -- 「見つかりにくい装備」をやるなら、迷彩率という別の数値として入れる。
  appearance   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 試合
-- ============================================================
create table if not exists matches (
  id         uuid primary key,
  room       text not null,
  started_at timestamptz not null,
  ended_at   timestamptz,
  -- 'blue' | 'red' | 'draw'。決着しなかった試合は null のまま
  winner     text
);

create index if not exists matches_started_at_idx on matches (started_at desc);

-- 1 試合 1 人 1 行。
--
-- **行が独立している必要がある。** 離脱した人は試合が終わる頃にはもう居ないので、
-- 席を畳むときにその人の行だけ先に書く。「終わったら全員分まとめて」では拾えない。
create table if not exists match_players (
  match_id    uuid not null references matches (id) on delete cascade,
  player_id   uuid not null references players (id),
  team        text not null,
  kills       int  not null default 0,
  deaths      int  not null default 0,
  -- 与えたヘッドショットと、**受けた**ヘッドショット。
  -- MGO2 はやられた側も記録していた。上手さだけでなく「どうやられたか」を見せる
  headshots   int  not null default 0,
  head_deaths int  not null default 0,
  -- 自爆。倒された数には入るが、誰かの手柄にはならない
  suicides    int  not null default 0,
  -- 武器ごとのキル。**表示名ではなく安定した id で持つ**
  -- ('rifle' | 'sniper' | 'pistol' | 'knife' | 'grenade')。
  -- 銃の表示名を変えたときに過去の記録が壊れないように
  by_weapon   jsonb not null default '{}'::jsonb,
  -- 途中で抜けたか。リロード (30 秒以内に戻る) は数えない
  left_early  boolean not null default false,
  primary key (match_id, player_id)
);

create index if not exists match_players_player_idx on match_players (player_id);

-- ============================================================
-- 合計
-- ============================================================
--
-- 生の行から数え上げる。プロフィール画面はここを読む。
create or replace view player_totals as
select
  p.id            as player_id,
  p.name,
  p.created_at,
  count(mp.*)                                          as matches,
  count(mp.*) filter (where mp.left_early)             as abandons,
  coalesce(sum(mp.kills), 0)                           as kills,
  coalesce(sum(mp.deaths), 0)                          as deaths,
  coalesce(sum(mp.headshots), 0)                       as headshots,
  coalesce(sum(mp.head_deaths), 0)                     as head_deaths,
  coalesce(sum(mp.suicides), 0)                        as suicides
-- 点 (kill +3 / death -2) はここで出さない。**式は src/sim/scoring.ts が持つ。**
-- SQL にも書くと 2 箇所になり、片方を直し忘れたときに成績表とプロフィールで
-- 違う点が出る。生の数だけ配って、出すのは読む側でやる
from players p
left join match_players mp on mp.player_id = p.id
group by p.id, p.name, p.created_at;

-- ============================================================
-- 誰が読めて、誰が書けるか
-- ============================================================
alter table players       enable row level security;
alter table matches       enable row level security;
alter table match_players enable row level security;

-- 読むのは認証済みの誰でも。**他人の戦績も見える** (MGO2 もそうだった)。
-- 成績表から名前を押したらその人のプロフィールが開く、をやりたいので
create policy "読むのは誰でも" on players       for select to authenticated using (true);
create policy "読むのは誰でも" on matches       for select to authenticated using (true);
create policy "読むのは誰でも" on match_players for select to authenticated using (true);

-- 表示名だけは本人が変えられる。**それ以外の列は触らせない**
create policy "名前は本人が変えられる" on players
  for update to authenticated
  using (auth_subject = auth.jwt() ->> 'sub')
  with check (auth_subject = auth.jwt() ->> 'sub');

-- 書き込みの policy は作らない。**サーバーだけが、下の関数を通して書く。**

-- ============================================================
-- サーバーが呼ぶ 1 本
-- ============================================================
--
-- security definer なので、呼べる人はテーブルの権限を持たなくても書ける。
-- 逆に言うと、**サーバーに渡すのはこの関数を呼ぶ権利だけ**で済む。
--
-- 冪等にしてある。同じ試合の同じ人を二度書いても増えない (書き直しになる) ので、
-- 送り直しで二重に記録されることがない。
create or replace function record_match_player(
  p_match_id    uuid,
  p_room        text,
  p_started_at  timestamptz,
  p_auth_subject text,
  p_name        text,
  p_team        text,
  p_kills       int,
  p_deaths      int,
  p_headshots   int,
  p_head_deaths int,
  p_suicides    int,
  p_by_weapon   jsonb,
  p_left_early  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid;
begin
  -- 試合。まだ無ければ作る (誰が最初に書き込むかは決まっていない)
  insert into matches (id, room, started_at)
  values (p_match_id, p_room, p_started_at)
  on conflict (id) do nothing;

  -- キャラ。まだ無ければ作る。**名前は上書きしない** —
  -- 本人が変えた表示名を、発行元の名前で戻してしまわないように
  insert into players (auth_subject, name)
  values (p_auth_subject, p_name)
  on conflict (auth_subject) do nothing;

  select id into v_player from players where auth_subject = p_auth_subject;

  insert into match_players (
    match_id, player_id, team, kills, deaths,
    headshots, head_deaths, suicides, by_weapon, left_early
  )
  values (
    p_match_id, v_player, p_team, p_kills, p_deaths,
    p_headshots, p_head_deaths, p_suicides, p_by_weapon, p_left_early
  )
  on conflict (match_id, player_id) do update set
    kills = excluded.kills,
    deaths = excluded.deaths,
    headshots = excluded.headshots,
    head_deaths = excluded.head_deaths,
    suicides = excluded.suicides,
    by_weapon = excluded.by_weapon,
    left_early = excluded.left_early;
end;
$$;

-- 試合の締め。決着したときにサーバーが 1 回呼ぶ。
--
-- **試合の行が既にあるとは限らない。** サーバーは記録の往復を待たない
-- (待つと全員の位置が止まる) ので、締めのほうが先に着くことがある。実際に
-- 手元で試したら 3 回のうち 3 回とも先に着いた。update だけだと 0 行に当たって
-- 勝敗が黙って消えるので、無ければ作る。
create or replace function close_match(
  p_match_id   uuid,
  p_room       text,
  p_started_at timestamptz,
  p_winner     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into matches (id, room, started_at, ended_at, winner)
  values (p_match_id, p_room, p_started_at, now(), p_winner)
  on conflict (id) do update set ended_at = now(), winner = p_winner;
end;
$$;

-- 呼べるのはサーバーだけ。**認証済みの利用者には渡さない**。
--
-- 引数まで書いて指定する。create or replace は引数が違うと**差し替えではなく
-- 追加**になるので、古い形が残っていると名前だけでは狙いが定まらない
revoke all on function record_match_player(uuid, text, timestamptz, text, text, text, int, int, int, int, int, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function close_match(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function record_match_player(uuid, text, timestamptz, text, text, text, int, int, int, int, int, jsonb, boolean)
  to service_role;
grant execute on function close_match(uuid, text, timestamptz, text)
  to service_role;

-- 引数を変えたときに古い形が残らないよう落とす (初回は何もしない)
drop function if exists close_match(uuid, text);
