import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ code: string }> };
type GameMode = "truth" | "dare" | "would_you_rather" | "couple_trivia";
type RoomGameMode = "truth_dare" | "would_you_rather" | "couple_trivia";

async function currentUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

async function roomForUser(code: string, userId: string) {
  const supabase = createSupabaseAdminClient();
  // Fetch in two explicit queries. This is more reliable than a nested relation
  // request while the schema is evolving and makes membership checks unambiguous.
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, join_code, status, host_player_id, current_player_id, selected_game_mode, room_game_mode, expires_at")
    .eq("join_code", code)
    .maybeSingle();
  if (roomError || !room || new Date(room.expires_at) <= new Date()) return null;

  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, auth_user_id, display_name, avatar_seed, is_host, is_ready")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });
  if (playersError || !players) return null;
  const me = players.find((player) => player.auth_user_id === userId);
  if (!me) return null;

  const { data: activeRound } = await supabase
    .from("rounds")
    .select("id, player_id, prompt_id, answer_text, answered_at")
    .eq("room_id", room.id)
    .eq("outcome", "active")
    .maybeSingle();
  let prompt: { id: string; text: string; game_mode: GameMode } | null = null;
  if (activeRound) {
    const { data } = await supabase.from("prompts").select("id, text, game_mode").eq("id", activeRound.prompt_id).maybeSingle();
    prompt = (data as typeof prompt) ?? null;
  }
  return { room, players, me, activeRound, prompt };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await currentUser(request);
    const { code } = await params;
    if (!user) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    const result = await roomForUser(code.toUpperCase(), user.id);
    if (!result) return NextResponse.json({ error: "This room is unavailable. Join it from the home page first." }, { status: 404 });
    return NextResponse.json({ room: result.room, players: result.players, myPlayerId: result.me.id, activeRound: result.activeRound, prompt: result.prompt });
  } catch {
    return NextResponse.json({ error: "We could not load this room." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await currentUser(request);
    const { code } = await params;
    if (!user) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    const result = await roomForUser(code.toUpperCase(), user.id);
    if (!result) return NextResponse.json({ error: "This room is unavailable." }, { status: 404 });
    const body = (await request.json()) as { action?: "toggle_ready" | "start" | "choose_prompt" | "submit_answer" | "complete" | "pass" | "end"; mode?: GameMode; answer?: string };
    const supabase = createSupabaseAdminClient();

    if (body.action === "toggle_ready") {
      if (result.room.status !== "lobby") return NextResponse.json({ error: "The game has already started." }, { status: 409 });
      const { error } = await supabase.from("players").update({ is_ready: !result.me.is_ready, last_seen_at: new Date().toISOString() }).eq("id", result.me.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "start") {
      if (!result.me.is_host) return NextResponse.json({ error: "Only the host can start the game." }, { status: 403 });
      if (result.players.length !== 2 || !result.players.every((player) => player.is_ready)) {
        return NextResponse.json({ error: "Both players need to be ready first." }, { status: 409 });
      }
      const { error } = await supabase.from("rooms").update({ status: "playing", current_player_id: result.room.host_player_id }).eq("id", result.room.id).eq("status", "lobby");
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "end") {
      if (!result.me.is_host) return NextResponse.json({ error: "Only the host can end the room." }, { status: 403 });
      const { error } = await supabase.from("rooms").update({ status: "ended" }).eq("id", result.room.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const isCurrentPlayer = result.room.current_player_id === result.me.id;
    const choosePrompt = async (mode: GameMode) => {
      const { data: prompts, error } = await supabase.from("prompts").select("id").eq("game_mode", mode).eq("active", true);
      if (error || !prompts?.length) throw new Error("There are no prompts available for that mode yet.");
      const prompt = prompts[Math.floor(Math.random() * prompts.length)];
      const { error: roundError } = await supabase.from("rounds").insert({ room_id: result.room.id, player_id: result.me.id, prompt_id: prompt.id });
      if (roundError) throw roundError;
      const { error: roomError } = await supabase.from("rooms").update({ selected_game_mode: mode }).eq("id", result.room.id);
      if (roomError) throw roomError;
    };

    if (body.action === "choose_prompt") {
      const modes: GameMode[] = ["truth", "dare", "would_you_rather", "couple_trivia"];
      const allowedModes: Record<RoomGameMode, GameMode[]> = { truth_dare: ["truth", "dare"], would_you_rather: ["would_you_rather"], couple_trivia: ["couple_trivia"] };
      const permitted = allowedModes[result.room.room_game_mode as RoomGameMode] ?? [];
      if (result.room.status !== "playing" || !isCurrentPlayer || result.activeRound || !body.mode || !modes.includes(body.mode) || !permitted.includes(body.mode)) {
        return NextResponse.json({ error: "It is not time to choose a prompt." }, { status: 409 });
      }
      await choosePrompt(body.mode);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "submit_answer") {
      const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 500) : "";
      if (result.room.status !== "playing" || !isCurrentPlayer || !result.activeRound || result.activeRound.player_id !== result.me.id) {
        return NextResponse.json({ error: "Only the active player can answer this prompt." }, { status: 409 });
      }
      if (!answer) return NextResponse.json({ error: "Write an answer before sharing it." }, { status: 400 });
      const { error } = await supabase.from("rounds").update({ answer_text: answer, answered_at: new Date().toISOString() }).eq("id", result.activeRound.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "complete" || body.action === "pass") {
      if (result.room.status !== "playing" || !isCurrentPlayer || !result.activeRound || result.activeRound.player_id !== result.me.id) {
        return NextResponse.json({ error: "Only the active player can finish this turn." }, { status: 409 });
      }
      const otherPlayer = result.players.find((player) => player.id !== result.me.id);
      if (!otherPlayer) return NextResponse.json({ error: "Waiting for the other player." }, { status: 409 });
      await supabase.from("rounds").update({ outcome: body.action === "pass" ? "passed" : "completed", completed_at: new Date().toISOString() }).eq("id", result.activeRound.id);
      const { error } = await supabase.from("rooms").update({ current_player_id: otherPlayer.id, selected_game_mode: null }).eq("id", result.room.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown room action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "We could not update the room." }, { status: 500 });
  }
}
