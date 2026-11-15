import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

function HomePage() {
  return (
    <main className="page-shell">
      <header className="topbar"><Link className="brand" to="/">rateforces<span>.</span></Link><span className="status"><i /> Codeforces practice, on your terms</span></header>
      <section className="hero">
        <div className="eyebrow"><span>01</span> FOCUSED PRACTICE</div>
        <h1>Make every<br /><em>round count.</em></h1>
        <p className="intro">Build a timed practice round from Codeforces problems. Pick your difficulty, set the clock, and focus on solving.</p>
        <Link className="primary-button" to="/link-account">Link Codeforces account <span aria-hidden="true">↗</span></Link>
        <p className="footnote">No RateForces password. Just your Codeforces handle.</p>
      </section>
      <footer><span>BUILT FOR THE NEXT PROBLEM</span><span>CODEFORCES COMPANION · BETA</span></footer>
    </main>
  );
}

function LinkAccountPage() {
  const [handle, setHandle] = useState("");
  const [challenge, setChallenge] = useState<{ challengeId: string; handle: string; targetContestId: number; targetProblemIndex: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/auth/verification", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ handle }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not start verification.");
      setChallenge(payload.data); setMessage("Challenge started. Submit a Compilation error on the configured problem.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start verification."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!challenge) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/auth/verification/${challenge.challengeId}`, { credentials: "include" });
        const payload = await response.json();
        if (!cancelled && payload.data?.status === "VERIFIED") navigate("/dashboard");
        else if (!cancelled && payload.data?.status === "EXPIRED") setMessage("Challenge expired. Start a new verification to try again.");
      } catch { if (!cancelled) setMessage("Verification status is temporarily unavailable. Retrying…"); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [challenge, navigate]);
  return <main className="simple-page"><Link className="brand" to="/">rateforces<span>.</span></Link><p className="eyebrow">ACCOUNT LINKING</p><h1>Connect your<br /><em>Codeforces handle.</em></h1>
    {!challenge && <form className="link-form" onSubmit={submit}><label htmlFor="handle">Codeforces handle</label><input id="handle" autoComplete="username" value={handle} onChange={(event) => setHandle(event.target.value)} minLength={3} maxLength={24} required placeholder="tourist" /><button className="primary-button" disabled={busy}>{busy ? "Checking handle…" : "Continue"}<span aria-hidden="true">↗</span></button></form>}
    {challenge && <section className="challenge-card"><strong>Submit a Compilation error</strong><p>Open <a href={`https://codeforces.com/problemset/problem/${challenge.targetContestId}/${challenge.targetProblemIndex}`} target="_blank" rel="noreferrer">{challenge.targetContestId}{challenge.targetProblemIndex}</a> on Codeforces and submit code that produces a CE. Keep this page open; it checks automatically.</p><small>Challenge expires {new Date(challenge.expiresAt).toLocaleTimeString()}.</small></section>}
    {message && <p className="form-message" role="status">{message}</p>}<Link className="text-link" to="/">← Back to home</Link></main>;
}

function DashboardPage() {
  const [profile, setProfile] = useState<{ codeforcesHandle: string; rating: number | null; rank: string | null; historySyncComplete: boolean; historySyncCursor: number } | null>(null);
  const [rounds, setRounds] = useState<{ id: string; status: string; targetRating: number; createdAt: string; problems: { id: string; name: string }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => { fetch("/api/v1/me", { credentials: "include" }).then(async (response) => { if (!response.ok) { navigate("/link-account"); return null; } return response.json(); }).then(async (payload) => { if (payload?.data) { setProfile(payload.data); const history = await fetch("/api/v1/rounds", { credentials: "include" }); if (history.ok) setRounds((await history.json()).data); } }).finally(() => setLoading(false)); }, [navigate]);
  if (loading) return <main className="simple-page"><p className="intro">Loading your account…</p></main>;
  return <main className="simple-page"><Link className="brand" to="/">rateforces<span>.</span></Link><p className="eyebrow">YOUR DASHBOARD</p><h1>Welcome,<br /><em>{profile?.codeforcesHandle ?? "solver"}.</em></h1><p className="intro">{profile?.rank ?? "Unrated"}{profile?.rating ? ` · ${profile.rating}` : ""}</p>{profile && !profile.historySyncComplete && <p className="sync-state" role="status">Importing your Codeforces history · {Math.max(0, profile.historySyncCursor - 1).toLocaleString()} submissions checked</p>}{profile?.historySyncComplete && <p className="sync-state" role="status">Codeforces history sync complete.</p>}<Link className="primary-button" to="/rounds/new">Create a practice round <span aria-hidden="true">↗</span></Link><section className="round-history"><p className="eyebrow">ROUND HISTORY</p>{rounds.length ? rounds.map((round) => <Link key={round.id} className="round-row" to={`/rounds/${round.id}`}><span>{round.targetRating} rating · {round.problems.length} problems</span><small>{round.status}</small></Link>) : <p className="intro">No rounds yet. Your first practice round starts here.</p>}</section></main>;
}

type FilterOptions = { years: number[]; ratings: number[]; tags: string[] };
function CreateRoundPage() {
  const [filters, setFilters] = useState<FilterOptions>({ years: [], ratings: [], tags: [] });
  const [rating, setRating] = useState(1200);
  const [yearMode, setYearMode] = useState("RANDOM");
  const [years, setYears] = useState<number[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState("ANY");
  const [duration, setDuration] = useState(90);
  const [count, setCount] = useState(5);
  const [includeSolved, setIncludeSolved] = useState(true);
  const [preview, setPreview] = useState<{ eligibleCount: number; enoughProblems: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { fetch("/api/problemset/filters").then((response) => response.json()).then((value: FilterOptions) => { setFilters(value); if (value.ratings.length && !value.ratings.includes(rating)) setRating(value.ratings[0]!); }).catch(() => setError("Could not load the problem filters.")); }, []);
  const config = { targetRating: rating, yearMode, selectedYears: years, durationMinutes: duration, problemCount: count, selectedTags: tags, tagMatchMode, includeSolved };
  async function inspect() {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ targetRating: String(rating), yearMode, selectedYears: years.join(","), durationMinutes: String(duration), problemCount: String(count), selectedTags: tags.join(","), tagMatchMode, includeSolved: String(includeSolved) });
      const response = await fetch(`/api/v1/problemset/preview?${query}`, { credentials: "include" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not preview this round."); setPreview(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview this round."); }
    finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/v1/rounds", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(config) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Could not create round."); navigate(`/rounds/${payload.data.id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create round."); }
    finally { setBusy(false); }
  }
  return <main className="simple-page builder-page"><Link className="brand" to="/dashboard">rateforces<span>.</span></Link><p className="eyebrow">NEW PRACTICE ROUND</p><h1>Set your<br /><em>parameters.</em></h1>
    <div className="builder-grid"><label>Exact problem rating<select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{filters.ratings.map((value) => <option key={value}>{value}</option>)}</select></label><label>Round duration (minutes)<input type="number" min={5} max={300} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label><label>Number of problems<input type="number" min={1} max={20} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><label>Year selection<select value={yearMode} onChange={(event) => setYearMode(event.target.value)}><option value="RANDOM">Random · all available years</option><option value="SELECTED">Choose years</option></select></label></div>
    {yearMode === "SELECTED" && <fieldset className="tag-list"><legend>Contest years</legend>{filters.years.map((year) => <label key={year}><input type="checkbox" checked={years.includes(year)} onChange={(event) => setYears(event.target.checked ? [...years, year] : years.filter((item) => item !== year))} />{year}</label>)}</fieldset>}
    <fieldset className="tag-list"><legend>Tags</legend>{filters.tags.map((tag) => <label key={tag}><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags(event.target.checked ? [...tags, tag] : tags.filter((item) => item !== tag))} />{tag}</label>)}</fieldset>
    {tags.length > 0 && <label className="field-inline">Tag matching<select value={tagMatchMode} onChange={(event) => setTagMatchMode(event.target.value)}><option value="ANY">Any selected tag</option><option value="ALL">All selected tags</option></select></label>}
    <label className="check-line"><input type="checkbox" checked={includeSolved} onChange={(event) => setIncludeSolved(event.target.checked)} />Include problems I have already solved</label>
    <div className="builder-actions"><button className="secondary-button" disabled={busy} onClick={inspect}>{busy ? "Checking…" : "Preview availability"}</button>{preview && <span>{preview.eligibleCount} eligible{preview.enoughProblems ? " · ready to create" : ` · need ${count}`}</span>}{preview?.enoughProblems && <button className="primary-button" disabled={busy} onClick={create}>Create lobby <span aria-hidden="true">↗</span></button>}</div>{error && <p className="form-message" role="alert">{error}</p>}
  </main>;
}

function RoundPage() {
  const [round, setRound] = useState<{ id: string; status: string; targetRating: number; durationMinutes: number; startedAt: string | null; endsAt: string | null; lastSyncedAt: string | null; problems: { id: string; contestId: number; problemIndex: string; name: string; rating: number | null; tags: string[]; url: string; status: string; firstStartedAt: string | null; acceptedAt: string | null; acceptedSubmissionUrl: string | null; attemptCount: number; failedAttemptCount: number; activeWorkSeconds: number; workSessions: { startedAt: string; endedAt: string | null }[] }[] } | null>(null);
  const [error, setError] = useState("");
  const { roundId: id } = useParams();
  const [now, setNow] = useState(Date.now());
  const load = async () => { if (!id) return; try { const response = await fetch(`/api/v1/rounds/${id}`, { credentials: "include" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Could not load this round."); setRound(payload.data); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load round."); } };
  useEffect(() => { void load(); const refresh = window.setInterval(() => void load(), 5000); return () => window.clearInterval(refresh); }, [id]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const elapsed = (timestamp: string | null) => timestamp ? Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000)) : 0;
  const timeLabel = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  async function roundAction(path: string) { if (!id) return; setError(""); try { const response = await fetch(`/api/v1/rounds/${id}${path}`, { method: "POST", credentials: "include" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Action failed."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); } }
  const solved = round?.problems.filter((problem) => problem.status === "SOLVED").length ?? 0;
  return <main className="simple-page"><Link className="brand" to="/dashboard">rateforces<span>.</span></Link>{error && <p className="form-message" role="alert">{error}</p>}{round && <><p className="eyebrow">{round.status} · {round.durationMinutes} MINUTES</p><h1>Rating<br /><em>{round.targetRating}.</em></h1><section className="round-controls">{round.status === "LOBBY" && <><p className="intro">Your lobby is ready. The timer stays stopped until you start.</p><button className="primary-button" onClick={() => void roundAction("/start")}>Start round <span aria-hidden="true">↗</span></button></>}{round.status === "RUNNING" && <><div className="countdown">{timeLabel(Math.max(0, Math.ceil((new Date(round.endsAt!).getTime() - now) / 1000)))}</div><p className="intro">{solved} / {round.problems.length} solved · {round.problems.length - solved} remaining</p></>}{round.status === "COMPLETED" && <p className="intro">Round complete · {solved} / {round.problems.length} solved</p>}{round.status !== "LOBBY" && <small className="sync-freshness">{round.lastSyncedAt ? `Codeforces synced ${new Date(round.lastSyncedAt).toLocaleTimeString()}` : "Waiting for first Codeforces sync"}</small>}</section><section className="problem-list">{round.problems.map((problem, index) => { const active = problem.workSessions.find((session) => session.endedAt === null); const workSeconds = problem.activeWorkSeconds + (active ? Math.max(0, Math.floor((now - new Date(active.startedAt).getTime()) / 1000)) : 0); return <article className="problem-row" key={problem.id}><span className="problem-number">{String(index + 1).padStart(2, "0")}</span><div className="problem-content"><a href={problem.url} target="_blank" rel="noreferrer">{problem.name}</a><small>{problem.contestId}{problem.problemIndex} · {problem.rating ?? "Unrated"} · {problem.tags.join(" · ")}</small><small>{problem.status} · {problem.attemptCount} attempts · {problem.failedAttemptCount} failed · {problem.firstStartedAt ? `${timeLabel(workSeconds)} active` : "Active work N/A"}</small>{problem.acceptedAt && <small>Solved at +{timeLabel(elapsed(problem.acceptedAt) - elapsed(round.startedAt))} · <a href={problem.acceptedSubmissionUrl ?? "#"} target="_blank" rel="noreferrer">accepted submission</a></small>}{round.status === "RUNNING" && problem.status !== "SOLVED" && <button className="work-button" onClick={() => void roundAction(`/problems/${problem.id}/${problem.status === "IN_PROGRESS" ? "stop" : "start"}`)}>{problem.status === "IN_PROGRESS" ? "Pause work" : problem.status === "PAUSED" ? "Resume work" : "Start working"}</button>}</div></article>; })}</section></>}</main>;
}

export default function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/link-account" element={<LinkAccountPage />} /><Route path="/dashboard" element={<DashboardPage />} /><Route path="/rounds/new" element={<CreateRoundPage />} /><Route path="/rounds/:roundId" element={<RoundPage />} /><Route path="*" element={<HomePage />} /></Routes>;
}
