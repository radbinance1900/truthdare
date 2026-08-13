import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ code: string }> };

async function currentUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

async function roomForUser(code: string, userId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, expires_at")
    .eq("join_code", code)
    .maybeSingle();
  if (roomError || !room || new Date(room.expires_at) <= new Date()) return null;

  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("room_id", room.id)
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!player) return null;

  return { room, player };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await currentUser(request);
    const { code } = await params;
    if (!user) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    const result = await roomForUser(code.toUpperCase(), user.id);
    if (!result) return NextResponse.json({ error: "This room is unavailable." }, { status: 404 });

    const supabase = createSupabaseAdminClient();
    const { data: messages, error } = await supabase
      .from("messages")
      .select("id, player_id, content, created_at")
      .eq("room_id", result.room.id)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;

    return NextResponse.json({ messages: messages ?? [] });
  } catch {
    return NextResponse.json({ error: "We could not load messages." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await currentUser(request);
    const { code } = await params;
    if (!user) return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
    const result = await roomForUser(code.toUpperCase(), user.id);
    if (!result) return NextResponse.json({ error: "This room is unavailable." }, { status: 404 });

    const body = (await request.json()) as { content?: string };
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 500) : "";
    if (!content) return NextResponse.json({ error: "Write a message before sending." }, { status: 400 });

    const supabase = createSupabaseAdminClient();
    const { data: message, error } = await supabase
      .from("messages")
      .insert({ room_id: result.room.id, player_id: result.player.id, content })
      .select("id, player_id, content, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ message });
  } catch {
    return NextResponse.json({ error: "We could not send the message." }, { status: 500 });
  }
}