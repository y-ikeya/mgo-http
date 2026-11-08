import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import Profile from "../ui/Profile";
import { profilesAvailable } from "../../infra/api/profile";
import { useLevels } from "../../infra/api/levels";
import { t } from "../../i18n";
import { useLocation, useNavigate } from "@solidjs/router";
import { MODES } from "../../domain/match/room";
import { STAGES } from "../../domain/stage";
import { fetchRooms } from "../../infra/api/rooms";
import type { MatchPhase, RoomSummary } from "../../application/protocol/types";
import type { Team } from "../../domain/player/player";
import type { Identity } from "../../infra/auth/session";
import { signOut } from "../../infra/auth/session";
import { usePadNav } from "./padNav";
import "./Lobby.css";

/**
 * 部屋の一覧。
 *
 * 部屋はサーバーが決まった数だけ持っていて、増えたり消えたりしない。
 * 変わるのは中身 (人数・段階・得点) だけ。
 *
 * 「誰かが立てて人を待つ」形にしなかったのは、人が少ないうちは空の部屋が
 * 並ぶだけの一覧になるから。数を絞って固定すれば、入った先に誰か居る確率が上がる。
 */

/** 一覧を取り直す間隔 (ms)。人の出入りに気づける程度で、叩きすぎない */
const POLL_MS = 2000;

/** 段階の呼び名。引くたびに t() を通す (言語は起動時に決まっているので実質定数) */
const PHASE_LABEL: Record<MatchPhase, () => string> = {
  waiting: () => t("lobby.waiting"),
  assembled: () => t("lobby.assembled"),
  ready: () => t("lobby.ready"),
  countdown: () => t("lobby.countdown"),
  playing: () => t("lobby.playing"),
  // ラウンドの合間も試合中 (部屋の一覧ではそう見せる)
  break: () => t("lobby.playing"),
  over: () => t("lobby.over"),
};

/** 回し方の札 */
const ORDER_LABEL: Record<RoomSummary["order"], () => string> = {
  fixed: () => t("lobby.fixed"),
  cycle: () => t("lobby.rotation"),
  random: () => t("lobby.random"),
};

export default function Lobby(props: { identity: Identity }) {
  const navigate = useNavigate();
  /*
   * 部屋から戻された理由。**遷移に乗せて来る** (URL に付けない)。
   *
   * クエリに付けると、部屋へ入るときにそのまま持って行かれる (enter は
   * location.search を引き継ぐ) ので、部屋の中まで「退出しました」が付いて回る。
   */
  const route = useLocation<{ notice?: string }>();
  /*
   * **一度だけ出す。** 遷移の状態はブラウザの履歴 (history.state) に残るので、
   * そのまま読み続けるとリロードのたびに同じ知らせが出る。読んだら履歴から
   * 消して、押しても消せるようにする。
   */
  const [notice, setNotice] = createSignal(
    route.state?.notice === "expired" ? t("lobby.expired") : "",
  );
  onMount(() => {
    if (route.state?.notice) window.history.replaceState(null, "");
  });
  const [rooms, setRooms] = createSignal<RoomSummary[]>([]);
  const [error, setError] = createSignal("");
  /** 戦績を開いている相手。null なら閉じている */
  const [opened, setOpened] = createSignal<{ id: string; name: string } | null>(
    null,
  );
  // カードに出す Lv。入る前に「この部屋は強いのばかり」が読めるように
  const levelFor = useLevels(
    () => rooms().flatMap((room) => room.roster.map((who) => who.id)),
    props.identity,
  );

  const poll = async () => {
    try {
      setRooms(await fetchRooms());
      setError("");
    } catch {
      setError(t("lobby.unreachable"));
    }
  };

  onMount(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  /**
   * 居る人をチームに分ける。チーム戦はレッドとブルー (居なくても見出しは出す)、個人戦は 1 つ
   */
  const teamsOf = (room: RoomSummary): { team: Team | null; members: RoomSummary["roster"] }[] =>
    MODES[room.mode].teams && !MODES[room.mode].solo
      ? (["red", "blue"] as const).map((team) => ({
          team,
          members: room.roster.filter((who) => who.team === team),
        }))
      : [{ team: null, members: room.roster }];

  const full = (room: RoomSummary) => room.players >= room.capacity;
  /** 入れない部屋。まだ開けていないルール (TSNE は非殺傷武器が要る) */
  const shut = (room: RoomSummary) => !room.active;

  /**
   * 部屋へ移るとき、クエリをそのまま持っていく。
   *
   * `?server=` や `?panel=open` は部屋に入ってから読まれるので、
   * ここで落とすと効かない (手元の画面から本番のサーバーへ繋ぐ、ができなくなる)。
   */
  const enter = (name: string) => navigate(`/rooms/${name}${location.search}`);
  // パッドで選ぶ。○ で最初の画面へ (左上の MGOHTTP と同じ行き先)
  usePadNav({ back: () => navigate(`/${location.search}`) });

  return (
    <div class="lobby">
      <header class="lobby-head">
        {/* 押すと最初の画面 (対戦か練習かを選ぶ) へ戻る */}
        <button class="lobby-title lobby-home" onClick={() => navigate(`/${location.search}`)} title="最初の画面へ">
          MGOHTTP
        </button>
        <div class="lobby-who">
          {props.identity.displayName}
          <button
            class="lobby-signout"
            data-pad-skip
            onClick={() => {
              signOut();
              location.reload();
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <Show when={notice()}>
        <div class="lobby-error" onClick={() => setNotice("")} title="OK">
          {notice()}
        </div>
      </Show>
      <Show when={error()}>
        <div class="lobby-error">{error()}</div>
      </Show>

      <div class="lobby-rooms">
        <For each={rooms()}>
          {(room) => (
            <div
              class="room"
              classList={{
                "room-full": full(room),
                "room-live": room.phase === "playing" || room.phase === "break",
                "room-shut": shut(room),
              }}
            >
              {/*
                左: 部屋の中身 (ルール・ステージ・状態・人数)。押すと入る。
                右: 誰が居るか。**名前の札は別のボタン**なので、カードごと 1 つのボタンにはできない
              */}
              <button
                class="room-enter"
                disabled={full(room) || shut(room)}
                onClick={() => enter(room.name)}
              >
                <span class="room-name">{room.name}</span>
                {/*
                  ルールとステージ、それぞれが**固定かローテか**の札と中身
                  (2026-11-05 本人「rule が fix なのかを書いて欲しかった。rule についてと stage についての両方がある」)
                  ルールは今は部屋ごとに 1 つなので常に固定
                */}
                <span class="room-line">
                  <span class="room-line-label">{t("lobby.rule")}</span>
                  <span class="room-order room-order-fixed">{ORDER_LABEL.fixed()}</span>
                  <span class="room-mode">{room.mode}</span>
                </span>
                <span class="room-line">
                  <span class="room-line-label">{t("lobby.stage")}</span>
                  <span class={`room-order room-order-${room.order}`}>{ORDER_LABEL[room.order]()}</span>
                  <span class="room-stages">
                    <For each={room.stages}>
                      {(stage, i) => (
                        <>
                          <Show when={i() > 0}>
                            <span class="room-stage-arrow">{room.order === "random" ? "/" : "→"}</span>
                          </Show>
                          <span class="room-stage-name" classList={{ "room-stage-now": stage === room.stage }}>
                            {STAGES[stage].label}
                          </span>
                        </>
                      )}
                    </For>
                  </span>
                </span>

                {/* 状態。段階 / 得点 / 残り時間 */}
                <span class="room-status">
                  <span class="room-phase">{shut(room) ? t("lobby.shut") : PHASE_LABEL[room.phase]()}</span>
                  <Show
                    when={
                      MODES[room.mode].tickets &&
                      (room.phase === "playing" || room.phase === "break" || room.phase === "over")
                    }
                  >
                    <span class="room-score">
                      <span class="room-blue">{room.blue}</span>
                      <span class="room-dash">–</span>
                      <span class="room-red">{room.red}</span>
                    </span>
                  </Show>
                  <Show when={room.remaining > 0}>
                    <span class="room-time">
                      {Math.floor(room.remaining / 60)}:{String(room.remaining % 60).padStart(2, "0")}
                    </span>
                  </Show>
                </span>

                {/* 部屋の覚え書き。**ルールの名前だけでは伝わらないこと** (同じ TDM でも狙撃銃だけ、など) */}
                <Show when={room.note}>
                  <span class="room-note">{room.note}</span>
                </Show>

                {/* 人数と埋まり具合。1 人 1 目盛り — 数字を読む前に埋まり具合が分かる */}
                <span class="room-fill">
                  <span class="room-fill-label">{t("lobby.players")}</span>
                  <span class="room-count">
                    {room.players} / {room.capacity}
                  </span>
                  <span class="room-ticks">
                    <For each={Array.from({ length: room.capacity }, (_, i) => i)}>
                      {(i) => <span class="room-tick" classList={{ "room-tick-on": i < room.players }} />}
                    </For>
                  </span>
                </span>
              </button>

              {/*
                誰が居るか。**部屋は人数ではなく人で選ぶ。** チーム戦はチームごとに分けて並べる。
                押すとその人の通算が開く (戦績の設定が無い環境では押せない)
              */}
              <div class="room-roster">
                <Show
                  when={room.roster.length > 0}
                  fallback={<span class="room-nobody">{t("lobby.nobody")}</span>}
                >
                  <For each={teamsOf(room)}>
                    {(group) => (
                      <div class={`room-team room-team-${group.team ?? "all"}`}>
                        <Show when={group.team}>
                          <div class="room-team-head">
                            <span class="room-team-dot" />
                            {group.team === "red" ? t("lobby.red") : t("lobby.blue")}
                            <span class="room-team-count">{group.members.length}</span>
                          </div>
                        </Show>
                        <For each={group.members}>
                          {(who) => (
                            <button
                              class="room-player"
                              disabled={!profilesAvailable}
                              onClick={() => setOpened({ id: who.id, name: who.name })}
                            >
                              <span class="room-player-lv">{levelFor(who.id)}</span>
                              <span class="room-player-name">{who.name}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={rooms().length === 0 && !error()}>
        <div class="lobby-empty">{t("lobby.loading")}</div>
      </Show>

      <Show when={opened()} keyed>
        {(who) => (
          <Profile
            subject={who.id}
            fallbackName={who.name}
            identity={props.identity}
            onClose={() => setOpened(null)}
          />
        )}
      </Show>
    </div>
  );
}
