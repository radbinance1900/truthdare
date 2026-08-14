"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const gameModes = [
  { icon: "💬", title: "Truth or Dare", text: "Choose between a truth and a playful dare every turn.", tone: "truth", gameMode: "truth_dare" as const },
  { icon: "↔", title: "Would You Rather", text: "Pick between two wonderfully odd choices.", tone: "wyr", gameMode: "would_you_rather" as const },
  { icon: "🧠", title: "Couple Trivia", text: "How well do you know each other?", tone: "trivia", gameMode: "couple_trivia" as const },
];

export default function HomePage() {
  return <Suspense fallback={<main className="site-shell" />}><HomeContent /></Suspense>;
}

function HomeContent() {
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get("join")?.toUpperCase() ?? "";
  const [panel, setPanel] = useState<"none" | "create" | "join">(inviteCode ? "join" : "none");
  const [name, setName] = useState("");
  const [code, setCode] = useState(inviteCode);
  const [notice, setNotice] = useState("");
  const [selectedGame, setSelectedGame] = useState<"truth_dare" | "would_you_rather" | "couple_trivia" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  function showPanel(nextPanel: "create" | "join", gameMode?: "truth_dare" | "would_you_rather" | "couple_trivia") {
    setPanel(nextPanel);
    if (gameMode) setSelectedGame(gameMode);
    setNotice("");
  }

  async function requestRoom(action: "create" | "join") {
    const displayName = name.trim();
    if (!displayName) { setNotice("Add a nickname to continue."); return; }
    if (action === "join" && !code.trim()) { setNotice("Add a room code to continue."); return; }

    setIsSubmitting(true);
    setNotice("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      let session = sessionData.session;
      if (!session) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        session = data.session;
      }
      if (!session) throw new Error("We could not start your player session.");

      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, displayName, joinCode: code, gameMode: selectedGame }),
      });
      const result = (await response.json()) as { joinCode?: string; error?: string };
      if (!response.ok || !result.joinCode) throw new Error(result.error ?? "We could not open the room.");
      router.push(`/room/${result.joinCode}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestRoom("create");
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestRoom("join");
  }

  return (
    <main className="site-shell">
      <div className="stripes" aria-hidden="true" />
      <div className="wrap">
        <header className="top">
          <a className="brand" href="#home" aria-label="Twogether home">
            <span className="mark" aria-hidden="true">🍵</span>
            <span>
              <strong>Twogether</strong>
              <small>Game night · for two</small>
            </span>
          </a>
          <span className="pill">No room yet</span>
        </header>

        <section id="home" className="hero" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">A little game night, wherever you are</p>
            <h1 id="hero-title">Turns and <em>truths</em>, made for two.</h1>
            <p className="lead">A cozy collection of playful, general-audience games for two people. Join from anywhere, play at your pace, and pass any prompt—no explanation needed.</p>
            <div className="cta-row">
              <button className="button primary" onClick={() => document.getElementById("game-modes")?.scrollIntoView({ behavior: "smooth" })}>Choose a game</button>
              <button className="button ghost" onClick={() => showPanel("join")}>Join with a code</button>
            </div>
          </div>

          <aside className="sticker" aria-label="A preview of a game conversation">
            <div className="top-strip" />
            <span className="badge">YOUR TURN</span>
            <h2>Pick a card</h2>
            <p>Easygoing prompts, one turn at a time.</p>
            <div className="chat-preview">
              <span className="bubble them">Truth, dare, or wild card?</span>
              <span className="bubble me">Wild card. Surprise me! ✨</span>
            </div>
          </aside>
        </section>

        <section id="game-modes" className="modes" aria-labelledby="modes-title">
          <p className="section-label">Choose your vibe</p>
          <h2 id="modes-title">A game for every kind of catch-up.</h2>
          <div className="game-grid">
            {gameModes.map((mode) => (
              <button className={`game-card ${mode.tone}`} key={mode.title} onClick={() => showPanel("create", mode.gameMode)}>
                <span className="mode-icon" aria-hidden="true">{mode.icon}</span>
                <h3>{mode.title}</h3>
                <p>{mode.text}</p>
              </button>
            ))}
          </div>
        </section>

        {panel !== "none" && (
          <section className="panel" aria-labelledby="room-title">
            <button className="back" onClick={() => setPanel("none")}>← Back</button>
            <h2 id="room-title">{panel === "create" ? "Start your game room" : "Join the game"}</h2>
            <p>{panel === "create" ? `You chose ${gameModes.find((mode) => mode.gameMode === selectedGame)?.title ?? "a game"}. Choose a nickname to continue.` : "Ask your partner for their room code, then jump in."}</p>
            <form onSubmit={panel === "create" ? handleCreate : handleJoin}>
              <label htmlFor="name">Your nickname</label>
              <input id="name" value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="e.g. Vanilla" autoComplete="nickname" />
              {panel === "join" && <>
                <label htmlFor="code">Room code</label>
                <input id="code" value={code} maxLength={12} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="MINT-42" autoCapitalize="characters" />
              </>}
              <button className="button primary wide" type="submit" disabled={isSubmitting}>{isSubmitting ? "Just a moment…" : panel === "create" ? "Create room" : "Join room"}</button>
            </form>
            {notice && <p className="notice" role="status">{notice}</p>}
          </section>
        )}

        <p className="gateway-note">No accounts, saved answers, or uploads. Play at your pace—and pass any prompt whenever you want.</p>
      </div>
    </main>
  );
}
