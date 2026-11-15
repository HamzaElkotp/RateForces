import { Link, Route, Routes } from "react-router-dom";

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
  return <main className="simple-page"><Link className="brand" to="/">rateforces<span>.</span></Link><p className="eyebrow">ACCOUNT LINKING</p><h1>Connect your<br /><em>Codeforces handle.</em></h1><p className="intro">Account verification arrives in Phase 2. The foundation is ready; this step will be enabled once secure challenge verification is implemented.</p><Link className="text-link" to="/">← Back to home</Link></main>;
}

export default function App() {
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/link-account" element={<LinkAccountPage />} /><Route path="*" element={<HomePage />} /></Routes>;
}
