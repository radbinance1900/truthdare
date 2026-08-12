"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Player = { id: string; auth_user_id: string; display_name: string; avatar_seed: string; is_host: boolean; is_ready: boolean };
type GameMode = "truth" | "dare" | "would_you_rather" | "couple_trivia";
type RoomGameMode = "truth_dare" | "would_you_rather" | "couple_trivia";
type Room = { id: string; join_code: string; status: "lobby" | "playing" | "ended"; current_player_id: string | null; selected_game_mode: GameMode | null; room_game_mode: RoomGameMode };
type ActiveRound = { id: string; player_id: string; prompt_id: string; answer_text: string | null; answered_at: string | null };
type Prompt = { id: string; text: string; game_mode: GameMode };
const modeLabels: Record<GameMode, string> = { truth: "Truth", dare: "Dare", would_you_rather: "Would You Rather", couple_trivia: "Couple Trivia" };
const roomGameLabels: Record<RoomGameMode, string> = { truth_dare: "Truth or Dare", would_you_rather: "Would You Rather", couple_trivia: "Couple Trivia" };

export default function RoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const router = useRouter();
  const code = decodeURIComponent(rawCode).toUpperCase();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [activeRound, setActiveRound] = useState<ActiveRound | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("Loading room…");
  const [busy, setBusy] = useState(false);

  const requestHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Your player session is missing. Please return home and join again.");
    return { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` };
  }, [supabase]);

  const loadRoom = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { headers: await requestHeaders(), cache: "no-store" });
      const data = (await response.json()) as { room?: Room; players?: Player[]; myPlayerId?: string; activeRound?: ActiveRound | null; prompt?: Prompt | null; error?: string };
      if (!response.ok || !data.room || !data.players || !data.myPlayerId) throw new Error(data.error ?? "We could not load this room.");
      setRoom(data.room); setPlayers(data.players); setMyPlayerId(data.myPlayerId); setActiveRound(data.activeRound ?? null); setPrompt(data.prompt ?? null); setMessage("");
    } catch (error) {
      const text = error instanceof Error ? error.message : "We could not load this room.";
      if (text.includes("Join it from the home page")) {
        router.replace(`/?join=${encodeURIComponent(code)}`);
        return;
      }
      setMessage(text);
    }
  }, [code, requestHeaders]);

  useEffect(() => { void loadRoom(); }, [loadRoom]);

  // Realtime is fast when available; polling keeps both devices in sync if a
  // browser, network, or realtime policy prevents a subscription update.
  useEffect(() => {
    const interval = window.setInterval(() => void loadRoom(), 1500);
    return () => window.clearInterval(interval);
  }, [loadRoom]);

  useEffect(() => {
    const channel = supabase.channel(`room-lobby-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => void loadRoom())
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => void loadRoom())
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => void loadRoom())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [code, loadRoom, supabase]);

  async function updateRoom(action: "toggle_ready" | "start" | "choose_prompt" | "submit_answer" | "complete" | "pass" | "end", mode?: GameMode) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { method: "PATCH", headers: await requestHeaders(), body: JSON.stringify({ action, mode, answer }) });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "We could not update the room.");
      if (action === "submit_answer") setAnswer("");
      await loadRoom();
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not update the room."); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/?join=${code}`); setMessage("Invite link copied. Your partner can enter a nickname and join."); }
    catch { setMessage(`Share this code with your partner: ${code}`); }
  }

  const me = players.find((player) => player.id === myPlayerId);
  const bothReady = players.length === 2 && players.every((player) => player.is_ready);
  const activePlayer = players.find((player) => player.id === room?.current_player_id);
  const isMyTurn = room?.current_player_id === myPlayerId;
  const choices: GameMode[] = room?.room_game_mode === "truth_dare" ? ["truth", "dare"] : room?.room_game_mode === "would_you_rather" ? ["would_you_rather"] : ["couple_trivia"];

  function endRoom() {
    if (window.confirm("End this room for both players?")) void updateRoom("end");
  }

  return <main className="site-shell"><div className="stripes" aria-hidden="true" /><div className="wrap lobby-wrap">
    <header className="top"><a className="brand" href="/"><span className="mark">🍵</span><span><strong>Twogether</strong><small>Game night · for two</small></span></a><span className="pill">{room?.status === "playing" ? "Game started" : "Private room"}</span></header>
    {room?.status === "playing" && <aside className="game-room-info"><strong>{roomGameLabels[room.room_game_mode]}</strong><span>Room {code}</span></aside>}
    <section className={room?.status === "playing" ? "lobby-card playing-card" : "lobby-card"}>
      {room?.status !== "playing" && <>
      <p className="section-label">{room ? roomGameLabels[room.room_game_mode] : "Your private room"}</p><h1>{code}</h1><p className="lobby-lead">Share the code with your partner. Rooms are temporary and answers are never saved.</p>
      <button className="copy-button" onClick={copyInvite}>Copy invite link</button>
      <div className="players-heading"><h2>Players</h2><span>{players.length}/2 joined</span></div>
      <div className="player-list">
        {players.map((player) => <div className="player-row" key={player.id}><span className="avatar">{player.display_name.slice(0, 1).toUpperCase()}</span><span className="player-name">{player.display_name}{player.is_host && <small>Host</small>}</span><span className={player.is_ready ? "ready ready-on" : "ready"}>{player.is_ready ? "Ready" : "Not ready"}</span></div>)}
        {players.length < 2 && <div className="player-row waiting"><span className="avatar empty">?</span><span className="player-name">Waiting for your partner…</span></div>}
      </div>
      </>}
      {room?.status === "lobby" && me && <div className="lobby-actions"><button className="button ghost-dark" onClick={() => void updateRoom("toggle_ready")} disabled={busy}>{me.is_ready ? "I’m not ready" : "I’m ready"}</button>{me.is_host && <button className="button primary" onClick={() => void updateRoom("start")} disabled={!bothReady || busy}>Start game</button>}</div>}
      {room?.status === "playing" && <section className="game-stage">
        <p className="turn-label">{isMyTurn ? "Your turn" : `${activePlayer?.display_name ?? "Your partner"}’s turn`}</p>
        {!activeRound && <><h2>{isMyTurn ? (choices.length === 1 ? "Ready for your prompt?" : "Choose your move") : "They’re choosing a prompt…"}</h2>{isMyTurn && <div className="mode-actions">{choices.map((mode) => <button className="mode-choice" key={mode} onClick={() => void updateRoom("choose_prompt", mode)} disabled={busy}>{choices.length === 1 ? "Get prompt" : modeLabels[mode]}</button>)}</div>}</>}
        {activeRound && prompt && <div className="prompt-card"><span>{modeLabels[prompt.game_mode]}</span><h2>{prompt.text}</h2>{activeRound.answer_text && <div className="shared-answer"><strong>{activePlayer?.display_name} shared:</strong><p>{activeRound.answer_text}</p></div>}{isMyTurn ? <><label className="answer-label" htmlFor="answer">Your answer</label><textarea id="answer" value={answer} maxLength={500} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer here…" /> <div className="prompt-actions"><button className="button ghost-dark" onClick={() => void updateRoom("pass")} disabled={busy}>Pass</button><button className="button ghost-dark" onClick={() => void updateRoom("submit_answer")} disabled={busy || !answer.trim()}>Share answer</button><button className="button primary" onClick={() => void updateRoom("complete")} disabled={busy}>Done</button></div></> : <p>{activeRound.answer_text ? "Their answer is above. They’ll move on when ready." : "Give them a moment—this is their turn."}</p>}</div>}
      </section>}
      {room?.status === "ended" && <section className="finished-state"><span aria-hidden="true">🍵</span><h2>Game night complete</h2><p>Thanks for playing. This room will be removed automatically after it expires.</p><a className="button primary" href="/">Create a new room</a></section>}
      {room?.status !== "ended" && me?.is_host && <button className="end-room" onClick={endRoom} disabled={busy}>End room</button>}
      {message && <p className="notice" role="status">{message}</p>}
    </section>
  </div></main>;
}
