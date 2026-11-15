import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";

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
  const [profile, setProfile] = useState<{ codeforcesHandle: string; rating: number | null; rank: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => { fetch("/api/v1/me", { credentials: "include" }).then(async (response) => { if (!response.ok) { navigate("/link-account"); return null; } return response.json(); }).then((payload) => { if (payload?.data) setProfile(payload.data); }).finally(() => setLoading(false)); }, [navigate]);
  if (loading) return <main className="simple-page"><p className="intro">Loading your account…</p></main>;
  return <main className="simple-page"><Link className="brand" to="/">rateforces<span>.</span></Link><p className="eyebrow">YOUR DASHBOARD</p><h1>Welcome,<br /><em>{profile?.codeforcesHandle ?? "solver"}.</em></h1><p className="intro">{profile?.rank ?? "Unrated"}{profile?.rating ? ` · ${profile.rating}` : ""}</p><p className="intro">Your problemset and round history will appear here as the next roadmap phases are built.</p></main>;
}

export default function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/link-account" element={<LinkAccountPage />} /><Route path="/dashboard" element={<DashboardPage />} /><Route path="*" element={<HomePage />} /></Routes>;
}
