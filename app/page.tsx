import ShipOrChipIn from "./ShipOrChipIn";
import { auth0, isAuth0Configured } from "../lib/auth0";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const isLocalDemo =
    (host.startsWith("localhost:") || host.startsWith("127.0.0.1:")) &&
    (await searchParams).demo === "1";

  if (isLocalDemo || !isAuth0Configured()) {
    return (
      <ShipOrChipIn
        viewer={{ name: "Jiyun", email: "jiyun@example.com", initials: "JK" }}
        authMode="demo"
      />
    );
  }

  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="signin-page">
        <div className="signin-shell">
          <section className="signin-card">
            <div className="signin-brand">
              <span className="brand-mark">S/C</span>
              <strong>Ship or Chip In</strong>
            </div>
            <h1>Group work, without the guessing.</h1>
            <p className="signin-copy">
              Assign the task, submit the proof, and let the team review it.
              If an authorized task fails, its Stripe test contribution moves
              the shared goal forward.
            </p>
            <ol className="signin-steps">
              <li><strong>Assign</strong><span>One owner and a real deadline.</span></li>
              <li><strong>Submit</strong><span>The team sees the finished work.</span></li>
              <li><strong>Review</strong><span>Two teammates make the call.</span></li>
            </ol>
            <div className="signin-actions">
              <a className="primary-button" href="/auth/login?screen_hint=signup">
                Start a team
              </a>
              <a className="outline-button" href="/auth/login">
                Sign in
              </a>
            </div>
            <small>
              Auth0 secures team accounts. Stripe stays in test mode, so no
              real money is charged.
            </small>
          </section>

          <aside className="signin-preview" aria-label="Example task workflow">
            <div className="preview-topline">
              <span>Launch Club</span>
              <small>Demo workspace</small>
            </div>
            <div className="preview-heading">
              <h2>One task.<br />No ambiguity.</h2>
              <span>Due today</span>
            </div>
            <article className="preview-task">
              <div>
                <span className="preview-status">Needs review</span>
                <strong>Ship the pricing page</strong>
              </div>
              <b>$5</b>
              <ul>
                <li>Works on mobile</li>
                <li>No broken links</li>
              </ul>
              <button type="button" tabIndex={-1}>Review submission</button>
            </article>
            <div className="preview-flow" aria-label="Assign, submit, review">
              <span className="complete">Assigned</span>
              <span className="complete">Submitted</span>
              <span className="current">Review</span>
            </div>
            <div className="preview-pot">
              <div>
                <small>Team piggy bank</small>
                <strong>$24 <span>of $40</span></strong>
              </div>
              <div className="preview-pot-track" aria-hidden="true">
                <span />
              </div>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  const name =
    typeof session.user.name === "string" && session.user.name.trim()
      ? session.user.name.trim()
      : typeof session.user.email === "string"
        ? session.user.email.split("@")[0]
        : "Teammate";
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <ShipOrChipIn
      viewer={{ name, email, initials }}
      authMode="auth0"
    />
  );
}
