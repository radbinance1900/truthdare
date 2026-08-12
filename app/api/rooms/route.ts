import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RoomGameMode = "truth_dare" | "would_you_rather" | "couple_trivia";
type RequestBody = { action?: "create" | "join"; displayName?: string; joinCode?: string; gameMode?: RoomGameMode };

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 24) : "";
}

function cleanCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") : "";
}

function createJoinCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const word = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  return `${word}-${Math.floor(10 + Math.random() * 90)}`;
}

async function authenticatedUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Your session has expired. Please try again." }, { status: 401 });

    const body = (await request.json()) as RequestBody;
    const displayName = cleanName(body.displayName);
    if (!displayName) return NextResponse.json({ error: "Enter a nickname to continue." }, { status: 400 });

    const supabase = createSupabaseAdminClient();

    if (body.action === "create") {
      const gameMode = body.gameMode;
      if (!gameMode || !["truth_dare", "would_you_rather", "couple_trivia"].includes(gameMode)) {
        return NextResponse.json({ error: "Choose a game before creating a room." }, { status: 400 });
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const joinCode = createJoinCode();
        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .insert({ join_code: joinCode, room_game_mode: gameMode })
          .select("id, join_code")
          .single();

        if (roomError?.code === "23505") continue;
        if (roomError || !room) throw new Error("We could not create a room right now.");

        const { data: player, error: playerError } = await supabase
          .from("players")
          .insert({ room_id: room.id, auth_user_id: user.id, display_name: displayName, is_host: true })
          .select("id")
          .single();

        if (playerError || !player) {
          await supabase.from("rooms").delete().eq("id", room.id);
          throw new Error("We could not add you to the room.");
        }

        const { error: updateError } = await supabase
          .from("rooms")
          .update({ host_player_id: player.id, current_player_id: player.id })
          .eq("id", room.id);

        if (updateError) throw new Error("We could not finish creating the room.");
        return NextResponse.json({ joinCode: room.join_code });
      }
      throw new Error("Please try creating the room again.");
    }

    if (body.action === "join") {
      const joinCode = cleanCode(body.joinCode);
      if (!/^[A-Z]{4}-[0-9]{2}$/.test(joinCode)) {
        return NextResponse.json({ error: "Enter a room code like MINT-42." }, { status: 400 });
      }

      const { data: room } = await supabase
        .from("rooms")
        .select("id, join_code, status, expires_at")
        .eq("join_code", joinCode)
        .maybeSingle();

      if (!room || new Date(room.expires_at) <= new Date()) {
        return NextResponse.json({ error: "That room does not exist or has expired." }, { status: 404 });
      }
      if (room.status !== "lobby") return NextResponse.json({ error: "This game has already started." }, { status: 409 });

      const { count, error: countError } = await supabase
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id);
      if (countError) throw new Error("We could not check the room.");
      if ((count ?? 0) >= 2) return NextResponse.json({ error: "This room already has two players." }, { status: 409 });

      const { error: joinError } = await supabase
        .from("players")
        .upsert({ room_id: room.id, auth_user_id: user.id, display_name: displayName }, { onConflict: "room_id,auth_user_id" });
      if (joinError) throw new Error("We could not join that room.");

      return NextResponse.json({ joinCode: room.join_code });
    }

    return NextResponse.json({ error: "Unknown room action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
