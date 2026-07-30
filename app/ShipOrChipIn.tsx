"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Member = {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: string;
  payment_method_ready?: number;
};

type Pact = {
  id: string;
  title: string;
  assignee_id: string;
  due_label: string;
  due_at?: string | null;
  stake_cents: number;
  status: "active" | "review" | "appeal" | "complete" | "failed";
  criteria: string[];
  submission_note?: string | null;
  submission_url?: string | null;
  contribution_authorized?: number;
  contribution_status?:
    | "none"
    | "armed"
    | "pending"
    | "paused"
    | "processing"
    | "succeeded"
    | "needs_action"
    | "not_authorized";
  charge_after_at?: string | null;
  stripe_payment_intent_id?: string | null;
  approvals: number;
  rejections: number;
};

type Appeal = {
  id: string;
  team_id: string;
  pact_id: string;
  requester_id: string;
  category: "health" | "family" | "other";
  note?: string | null;
  requested_due_at: string;
  status: "pending" | "approved" | "rejected";
  resolved_by_id?: string | null;
  created_at: string;
  resolved_at?: string | null;
};

type Activity = {
  id: string;
  body: string;
  tone: "neutral" | "review" | "success" | "money";
  created_at: string;
};

type Team = {
  id: string;
  name: string;
  pot_cents: number;
  plan: "free" | "pro";
};

type AppState = {
  team: Team;
  current_member_id: string;
  members: Member[];
  pacts: Pact[];
  appeals: Appeal[];
  activities: Activity[];
};

const fallbackState: AppState = {
  team: { id: "demo", name: "Launch Club", pot_cents: 2400, plan: "free" },
  current_member_id: "m_jiyun",
  members: [
    {
      id: "m_jiyun",
      name: "Jiyun",
      email: "jiyun@example.com",
      initials: "JK",
      color: "#ff6542",
      role: "owner",
      payment_method_ready: 0,
    },
    {
      id: "m_maya",
      name: "Maya",
      email: "maya@example.com",
      initials: "MY",
      color: "#ffcc45",
      role: "reviewer",
    },
    {
      id: "m_theo",
      name: "Theo",
      email: "theo@example.com",
      initials: "TH",
      color: "#64c7bc",
      role: "member",
    },
    {
      id: "m_lex",
      name: "Lex",
      email: "lex@example.com",
      initials: "LX",
      color: "#9887ef",
      role: "member",
    },
  ],
  pacts: [
    {
      id: "p_pricing",
      title: "Ship the pricing page",
      assignee_id: "m_theo",
      due_label: "Today · 4:30 PM",
      stake_cents: 500,
      status: "review",
      criteria: [
        "Works on mobile",
        "Includes monthly and annual plans",
        "No broken links",
      ],
      submission_note: "Pricing page is live. I also tightened the comparison copy.",
      submission_url: "https://ship-or-chip-in.jiyun956706.chatgpt.site",
      approvals: 1,
      rejections: 0,
    },
    {
      id: "p_interviews",
      title: "Summarize five user interviews",
      assignee_id: "m_jiyun",
      due_label: "Tomorrow · 11:00 AM",
      stake_cents: 1000,
      status: "active",
      criteria: [
        "Five interview summaries",
        "Top three repeated problems",
        "One recommendation",
      ],
      approvals: 0,
      rejections: 0,
    },
    {
      id: "p_invites",
      title: "Connect the team invitation flow",
      assignee_id: "m_lex",
      due_label: "Friday · 2:00 PM",
      stake_cents: 500,
      status: "appeal",
      criteria: [
        "Invite email is delivered",
        "Invite expires after seven days",
        "Accepted member appears in roster",
      ],
      approvals: 0,
      rejections: 0,
    },
    {
      id: "p_copy",
      title: "Write onboarding copy",
      assignee_id: "m_maya",
      due_label: "Completed yesterday",
      stake_cents: 500,
      status: "complete",
      criteria: [
        "Under 120 words",
        "Explains voluntary commitments",
        "Includes one example",
      ],
      approvals: 2,
      rejections: 0,
    },
  ],
  appeals: [
    {
      id: "appeal_invites",
      team_id: "demo",
      pact_id: "p_invites",
      requester_id: "m_lex",
      category: "family",
      note: "A family situation came up. I need two more days; no further details.",
      requested_due_at: new Date(Date.now() + 76 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      created_at: new Date().toISOString(),
    },
  ],
  activities: [
    {
      id: "a_review",
      body: "Theo submitted “Ship the pricing page” for review.",
      tone: "review",
      created_at: new Date().toISOString(),
    },
    {
      id: "a_complete",
      body: "Maya shipped the onboarding copy. No chips required.",
      tone: "success",
      created_at: new Date().toISOString(),
    },
    {
      id: "a_pizza",
      body: "The pizza fund grew by $5 after a missed research deadline.",
      tone: "money",
      created_at: new Date().toISOString(),
    },
  ],
};

type Modal =
  | { type: "create"; openedAt: number }
  | { type: "importNotes"; openedAt: number }
  | { type: "review"; pact: Pact }
  | { type: "submit"; pact: Pact }
  | { type: "appeal"; pact: Pact; openedAt: number }
  | { type: "resolveAppeal"; pact: Pact; appeal: Appeal }
  | { type: "upgrade" }
  | { type: "invite"; url: string; expiresAt: string }
  | null;

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function ShipOrChipIn({
  viewer,
  authMode,
}: {
  viewer: { name: string; email: string; initials: string };
  authMode: "auth0" | "demo";
}) {
  const [state, setState] = useState<AppState>(fallbackState);
  const [filter, setFilter] = useState<"all" | "mine" | "review">("all");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const refreshState = () =>
      fetch("/api/state")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setState(data))
      .catch(() => setState(fallbackState));
    refreshState();

    const query = new URLSearchParams(window.location.search);
    const queryToast =
      query.get("joined") === "1"
        ? "You joined the crew. Welcome aboard."
        : query.get("contribution_setup") === "success"
          ? "Stripe received your test card. Automatic contributions are ready."
          : query.get("contribution_setup") === "cancelled"
            ? "Test card setup was cancelled."
        : query.get("checkout") === "success"
          ? "Stripe received the test checkout. Pro will activate shortly."
          : query.get("invite") === "invalid"
            ? "That invite is expired or has already been used."
            : "";
    if (queryToast) {
      window.setTimeout(() => setToast(queryToast), 0);
    }

    const setupRefresh =
      query.get("contribution_setup") === "success"
        ? window.setTimeout(refreshState, 1500)
        : undefined;
    return () => {
      if (setupRefresh) window.clearTimeout(setupRefresh);
    };
  }, []);

  useEffect(() => {
    const hasPendingContribution = state.pacts.some((pact) =>
      ["pending", "processing"].includes(pact.contribution_status ?? ""),
    );
    if (!hasPendingContribution) return;

    const timer = window.setInterval(() => {
      fetch("/api/state")
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => setState(data))
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [state.pacts]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visiblePacts = useMemo(() => {
    if (filter === "mine") {
      return state.pacts.filter(
        (pact) => pact.assignee_id === state.current_member_id,
      );
    }
    if (filter === "review") {
      return state.pacts.filter(
        (pact) => pact.status === "review" || pact.status === "appeal",
      );
    }
    return state.pacts;
  }, [filter, state.current_member_id, state.pacts]);

  const shipped = state.pacts.filter((pact) => pact.status === "complete").length;
  const openPacts = state.pacts.filter(
    (pact) =>
      pact.status === "active" ||
      pact.status === "review" ||
      pact.status === "appeal",
  ).length;
  const reviewPacts = state.pacts.filter(
    (pact) => pact.status === "review" || pact.status === "appeal",
  ).length;
  const dinnerGoalCents = 4000;
  const potPercent = Math.min(
    100,
    Math.max(0, Math.round((state.team.pot_cents / dinnerGoalCents) * 100)),
  );

  function memberFor(id: string) {
    return state.members.find((member) => member.id === id) ?? state.members[0];
  }

  function appealFor(pactId: string) {
    return state.appeals.find(
      (appeal) => appeal.pact_id === pactId && appeal.status === "pending",
    );
  }

  const currentMember = memberFor(state.current_member_id);

  async function act(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong");
      setState(data);
      setModal(null);
      setToast(success);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    setBusy(true);
    try {
      const response = await fetch("/api/invites", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create invite");
      setModal({ type: "invite", url: data.url, expiresAt: data.expiresAt });
      await navigator.clipboard?.writeText(data.url).catch(() => undefined);
      setToast("Invite link created and copied.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to create invite");
    } finally {
      setBusy(false);
    }
  }

  async function connectContributionCard() {
    setBusy(true);
    try {
      const response = await fetch("/api/stripe/contributions/setup", {
        method: "POST",
      });
      const responseText = await response.text();
      let data: { error?: string; url?: string } = {};
      if (responseText) {
        try {
          data = JSON.parse(responseText) as { error?: string; url?: string };
        } catch {
          data = {};
        }
      }
      if (!response.ok) throw new Error(data.error || "Unable to open Stripe");
      if (!data.url) throw new Error("Stripe did not return a setup page");
      window.location.assign(data.url);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Unable to connect a Stripe test card",
      );
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Ship or Chip In home">
          <span className="brand-mark">S/C</span>
          <span>Ship or Chip In</span>
        </a>
        <div className="team-switcher">
          <span>Team</span>
          {state.team.name}
          {authMode === "demo" && (
            <strong className="demo-label">Demo workspace</strong>
          )}
        </div>
        <nav className="top-actions" aria-label="Team actions">
          <button className="text-button" disabled={busy} onClick={createInvite}>
            Invite teammate
          </button>
          {authMode === "auth0" && (
            <a className="text-button signout-link" href="/auth/logout">
              Sign out
            </a>
          )}
          <button
            className="avatar avatar-main"
            aria-label={`Open ${viewer.name}’s account`}
            title={`Signed in as ${viewer.email || viewer.name}`}
          >
            {viewer.initials}
          </button>
        </nav>
      </header>

      <section className="hero-strip">
        <div>
          <h1>Team tasks</h1>
          <p className="page-summary">
            {openPacts} open · {reviewPacts} need review · {shipped} completed
          </p>
        </div>
        <div className="task-toolbar">
          <button
            className="outline-button"
            onClick={() =>
              setModal({ type: "importNotes", openedAt: Date.now() })
            }
          >
            Import meeting notes
          </button>
          <button
            className="primary-button"
            onClick={() => setModal({ type: "create", openedAt: Date.now() })}
          >
            New task
          </button>
        </div>
      </section>

      <div className="workflow-guide" role="note">
        <strong>How it works</strong>
        <span>Create a task, submit a work link, then get two teammate approvals.</span>
      </div>

      <section className="workspace">
        <div className="main-column">
          <div className="section-heading">
            <div>
              <h2>All tasks</h2>
              <p>Choose a task to submit work, review it, or request more time.</p>
            </div>
            <div className="filters" aria-label="Filter tasks">
              {[
                ["all", "All"],
                ["mine", "Mine"],
                ["review", "Needs review"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "filter active" : "filter"}
                  onClick={() => setFilter(value as typeof filter)}
                >
                  {label}
                  {value === "review" && (
                    <span>
                      {
                        state.pacts.filter(
                          (pact) =>
                            pact.status === "review" ||
                            pact.status === "appeal",
                        ).length
                      }
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="pact-list">
            {visiblePacts.map((pact) => {
              const member = memberFor(pact.assignee_id);
              const appeal = appealFor(pact.id);
              return (
                <article className={`pact-card status-${pact.status}`} key={pact.id}>
                  <div className="pact-body">
                    <div className="pact-top-row">
                      <div className="pact-meta">
                        <span className={`status-pill ${pact.status}`}>
                          {pact.status === "review"
                            ? "Needs review"
                            : pact.status === "appeal"
                              ? "Appeal pending"
                            : pact.status === "complete"
                              ? "Completed"
                              : pact.status === "failed"
                                ? pact.contribution_status === "succeeded"
                                  ? "Contribution sent"
                                  : "Task failed"
                                : "In progress"}
                        </span>
                        <span>{pact.due_label}</span>
                        {pact.contribution_status &&
                          pact.contribution_status !== "none" && (
                            <span
                              className={`contribution-pill ${pact.contribution_status}`}
                            >
                              {pact.contribution_status === "armed"
                                ? "Contribution authorized"
                                : pact.contribution_status === "pending"
                                  ? "30s appeal window"
                                  : pact.contribution_status === "processing"
                                    ? "Processing test payment"
                                    : pact.contribution_status === "succeeded"
                                      ? "Test contribution complete"
                                      : pact.contribution_status === "paused"
                                        ? "Contribution paused"
                                        : pact.contribution_status === "needs_action"
                                          ? "Update test card"
                                          : "No contribution authorized"}
                            </span>
                          )}
                      </div>
                      {pact.stake_cents > 0 && (
                        <div className="pact-stake">
                          <span>{money(pact.stake_cents)}</span>
                          <small>test contribution</small>
                        </div>
                      )}
                    </div>
                    <h3>{pact.title}</h3>
                    <div className="criteria-preview">
                      {pact.criteria.slice(0, 2).map((criterion) => (
                        <span key={criterion}>{criterion}</span>
                      ))}
                      {pact.criteria.length > 2 && (
                        <span>+{pact.criteria.length - 2} more</span>
                      )}
                    </div>
                    <div className="pact-footer">
                      <div className="assignee">
                        <span className="avatar small">
                          {member.initials}
                        </span>
                        <span>{member.name}</span>
                      </div>
                      {pact.status === "review" && (
                        pact.assignee_id === state.current_member_id ? (
                          <span className="approval-count">Waiting on crew</span>
                        ) : (
                          <button
                            className="review-button"
                            onClick={() => setModal({ type: "review", pact })}
                          >
                            Review submission
                          </button>
                        )
                      )}
                      {pact.status === "active" &&
                        (pact.assignee_id === state.current_member_id ||
                          currentMember.role === "owner") && (
                          <div className="pact-actions">
                            {pact.assignee_id === state.current_member_id && (
                              <button
                                className="review-button muted-action"
                                onClick={() =>
                                  setModal({
                                    type: "appeal",
                                    pact,
                                    openedAt: Date.now(),
                                  })
                                }
                              >
                                Need more time
                              </button>
                            )}
                            <button
                              className="review-button"
                              onClick={() => setModal({ type: "submit", pact })}
                            >
                              Submit work
                            </button>
                          </div>
                        )}
                      {pact.status === "appeal" &&
                        (appeal?.requester_id === state.current_member_id ? (
                          <span className="approval-count">Awaiting crew</span>
                        ) : appeal ? (
                          <button
                            className="review-button"
                            onClick={() =>
                              setModal({
                                type: "resolveAppeal",
                                pact,
                                appeal,
                              })
                            }
                          >
                            Review appeal
                          </button>
                        ) : (
                          <span className="approval-count">Appeal pending</span>
                        ))}
                      {pact.status === "complete" && (
                        <span className="approval-count">
                          {pact.approvals}/2 approved
                        </span>
                      )}
                      {pact.status === "failed" &&
                        pact.contribution_status === "pending" &&
                        pact.assignee_id === state.current_member_id && (
                          <button
                            className="review-button"
                            onClick={() =>
                              setModal({
                                type: "appeal",
                                pact,
                                openedAt: Date.now(),
                              })
                            }
                          >
                            Appeal test charge
                          </button>
                        )}
                      {pact.status === "failed" &&
                        pact.contribution_status === "needs_action" &&
                        pact.assignee_id === state.current_member_id && (
                          <button
                            className="review-button"
                            disabled={busy}
                            onClick={connectContributionCard}
                          >
                            Update test card
                          </button>
                        )}
                    </div>
                  </div>
                </article>
              );
            })}
            {visiblePacts.length === 0 && (
              <div className="empty-tasks">
                <strong>No tasks in this view</strong>
                <p>Try another filter to see the rest of the team&apos;s work.</p>
                <button className="outline-button" onClick={() => setFilter("all")}>
                  Show all tasks
                </button>
              </div>
            )}
          </div>
        </div>

        <aside className="side-column">
          <section className="pot-card">
            <div className="pot-topline">
              <h2>Team piggy bank</h2>
              <span className="stripe-badge">Stripe Sandbox</span>
            </div>
            <div
              className="piggy-bank"
              role="img"
              aria-label={`Piggy bank is ${potPercent}% full with ${money(state.team.pot_cents)} saved toward a $40 dinner goal`}
            >
              <span className="piggy-tail" aria-hidden="true" />
              <div className="piggy-body" aria-hidden="true">
                <span
                  className="piggy-fill"
                  style={{ transform: `scaleY(${potPercent / 100})` }}
                />
                <span className="piggy-slot" />
                <span className="piggy-value">
                  <strong>{money(state.team.pot_cents)}</strong>
                  <small>saved</small>
                </span>
              </div>
              <div className="piggy-head" aria-hidden="true">
                <span className="piggy-ear" />
                <span className="piggy-eye" />
                <span className="piggy-snout">
                  <i />
                  <i />
                </span>
              </div>
              <span className="piggy-leg piggy-leg-back" aria-hidden="true" />
              <span className="piggy-leg piggy-leg-front" aria-hidden="true" />
            </div>
            <div className="pot-labels">
              <span>{potPercent}% full</span>
              <span>$40 dinner goal</span>
            </div>
            <p className="pot-message">
              Test contributions move the team closer to its shared dinner goal.
            </p>
            <div
              className={
                currentMember.payment_method_ready
                  ? "contribution-connection connected"
                  : "contribution-connection"
              }
            >
              <div>
                <span className="connection-dot" aria-hidden="true" />
                <p>
                  <strong>
                    {currentMember.payment_method_ready
                      ? "Test card connected"
                      : "Test contributions are off"}
                  </strong>
                  <small>
                    {currentMember.payment_method_ready
                      ? "Authorized tasks can charge after the appeal window."
                      : "Connect a Stripe test card to authorize them."}
                  </small>
                </p>
              </div>
              <button
                className="dark-button"
                disabled={busy}
                onClick={connectContributionCard}
              >
                {currentMember.payment_method_ready
                  ? "Change test card"
                  : "Enable test contributions"}
              </button>
            </div>
            <small>Stripe Sandbox only. No real funds are held.</small>
          </section>

          <section className="crew-card">
            <div className="side-heading">
              <h3>Launch Club</h3>
              <span>{state.members.length}/5 seats</span>
            </div>
            <div className="crew-list">
              {state.members.map((member) => {
                const completed = state.pacts.filter(
                  (pact) =>
                    pact.assignee_id === member.id && pact.status === "complete",
                ).length;
                return (
                  <div className="crew-row" key={member.id}>
                    <span className="avatar small">
                      {member.initials}
                    </span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.role === "owner" ? "Team owner" : "Crew member"}</small>
                    </div>
                    <span className="ship-count">{completed} shipped</span>
                  </div>
                );
              })}
            </div>
            <button className="outline-button" disabled={busy} onClick={createInvite}>
              Invite a teammate
            </button>
          </section>

          <details className="activity-card">
            <summary>
              <span>Recent activity</span>
              <small>{state.activities.length} updates</small>
            </summary>
            <div className="activity-list">
              {state.activities.slice(0, 4).map((activity) => (
                <div className="activity-row" key={activity.id}>
                  <p>{activity.body}</p>
                </div>
              ))}
            </div>
          </details>

          {state.team.plan === "free" ? (
            <button className="upgrade-card" onClick={() => setModal({ type: "upgrade" })}>
              <span>
                <strong>Go Pro</strong>
                <small>Unlimited tasks and teammates</small>
              </span>
              <b>$12/month</b>
            </button>
          ) : (
            <div className="pro-card">
              <div>
                <strong>Launch Club is Pro</strong>
                <small>Stripe test subscription active</small>
              </div>
            </div>
          )}
        </aside>
      </section>

      <footer>
        <span>Voluntary commitments only.</span>
        <button
          onClick={() => act({ action: "reset" }, "Demo reset. Fresh tasks, fresh pizza.")}
        >
          Reset demo
        </button>
      </footer>

      {modal?.type === "create" && (
        <CreatePactModal
          members={state.members}
          currentMemberId={state.current_member_id}
          currentMember={currentMember}
          openedAt={modal.openedAt}
          busy={busy}
          close={() => setModal(null)}
          submit={(payload) => act(payload, "Task accepted. Time to ship.")}
        />
      )}
      {modal?.type === "importNotes" && (
        <ImportNotesModal
          members={state.members}
          openedAt={modal.openedAt}
          busy={busy}
          close={() => setModal(null)}
          submit={(payload) =>
            act(payload, "Meeting notes turned into assigned tasks.")
          }
        />
      )}
      {modal?.type === "review" && (
        <ReviewModal
          pact={modal.pact}
          member={memberFor(modal.pact.assignee_id)}
          busy={busy}
          close={() => setModal(null)}
          decide={(decision) =>
            act(
              { action: "review", pactId: modal.pact.id, decision },
              decision === "approve"
                ? "Vote counted. One step closer to shipped."
                : "Vote counted. The checklist keeps it fair.",
            )
          }
        />
      )}
      {modal?.type === "submit" && (
        <SubmitModal
          pact={modal.pact}
          busy={busy}
          close={() => setModal(null)}
          submit={(note, workUrl) =>
            act(
              {
                action: "submit",
                pactId: modal.pact.id,
                note,
                workUrl,
              },
              "Submission sent to the crew.",
            )
          }
        />
      )}
      {modal?.type === "appeal" && (
        <AppealModal
          pact={modal.pact}
          openedAt={modal.openedAt}
          busy={busy}
          close={() => setModal(null)}
          submit={(payload) =>
            act(payload, "Appeal sent. The deadline is paused for review.")
          }
        />
      )}
      {modal?.type === "resolveAppeal" && (
        <ResolveAppealModal
          pact={modal.pact}
          appeal={modal.appeal}
          member={memberFor(modal.appeal.requester_id)}
          busy={busy}
          close={() => setModal(null)}
          decide={(decision) =>
            act(
              {
                action: "resolveAppeal",
                appealId: modal.appeal.id,
                decision,
              },
              decision === "approve"
                ? "Extension approved. The new deadline is active."
                : "Original deadline kept. The decision was recorded.",
            )
          }
        />
      )}
      {modal?.type === "upgrade" && (
        <UpgradeModal
          close={() => setModal(null)}
        />
      )}
      {modal?.type === "invite" && (
        <InviteModal
          url={modal.url}
          expiresAt={modal.expiresAt}
          close={() => setModal(null)}
          copied={() => setToast("Invite link copied.")}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function ModalShell({
  children,
  close,
  label,
}: {
  children: React.ReactNode;
  close: () => void;
  label: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={close} aria-label="Close">×</button>
        {children}
      </section>
    </div>
  );
}

function CreatePactModal({
  members,
  currentMemberId,
  currentMember,
  openedAt,
  busy,
  close,
  submit,
}: {
  members: Member[];
  currentMemberId: string;
  currentMember: Member;
  openedAt: number;
  busy: boolean;
  close: () => void;
  submit: (payload: Record<string, unknown>) => void;
}) {
  const [criteria, setCriteria] = useState([
    "The final link works",
    "Meets the agreed scope",
  ]);
  const [assigneeId, setAssigneeId] = useState(currentMemberId);
  const [stake, setStake] = useState(
    currentMember.payment_method_ready ? 5 : 0,
  );
  const [contributionAuthorized, setContributionAuthorized] = useState(false);
  const canAuthorizeContribution =
    assigneeId === currentMemberId &&
    Boolean(currentMember.payment_method_ready);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submit({
      action: "create",
      title: data.get("title"),
      assigneeId,
      dueAt: data.get("dueAt"),
      stakeCents: stake * 100,
      criteria,
      contributionAuthorized: stake > 0 && contributionAuthorized,
    });
  }

  return (
    <ModalShell close={close} label="Create a new task">
      <h2>Create a task</h2>
      <p className="modal-intro">
        The owner must accept the task, deadline, checklist, and contribution.
      </p>
      <form onSubmit={onSubmit}>
        <label>
          What will ship?
          <input name="title" placeholder="e.g. Publish the launch email" required autoFocus />
        </label>
        <div className="form-grid">
          <label>
            Task owner
            <select
              name="assignee"
              value={assigneeId}
              onChange={(event) => {
                setAssigneeId(event.target.value);
                if (event.target.value !== currentMemberId) {
                  setStake(0);
                  setContributionAuthorized(false);
                }
              }}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input
              type="datetime-local"
              name="dueAt"
              min={localDateTimeValue(new Date(openedAt + 5 * 60 * 1000))}
              defaultValue={localDateTimeValue(
                new Date(openedAt + 24 * 60 * 60 * 1000),
              )}
              required
            />
          </label>
        </div>
        <label>
          Fair checklist
          <div className="criteria-editor">
            {criteria.map((criterion, index) => (
              <input
                key={index}
                value={criterion}
                aria-label={`Criterion ${index + 1}`}
                onChange={(event) =>
                  setCriteria((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
              />
            ))}
            <button
              type="button"
              onClick={() => setCriteria((items) => [...items, ""])}
            >
              Add criterion
            </button>
          </div>
        </label>
        <label>
          Voluntary contribution if the task fails
          <div className="stake-options">
            {[0, 5, 10, 25].map((amount) => (
              <label key={amount}>
                <input
                  type="radio"
                  name="stake"
                  value={amount}
                  checked={stake === amount}
                  disabled={amount > 0 && !canAuthorizeContribution}
                  onChange={() => {
                    setStake(amount);
                    if (amount === 0) setContributionAuthorized(false);
                  }}
                />
                <span>{amount === 0 ? "$0 / honor" : `$${amount}`}</span>
              </label>
            ))}
          </div>
        </label>
        {stake > 0 ? (
          <label className="charge-consent">
            <input
              type="checkbox"
              checked={contributionAuthorized}
              onChange={(event) =>
                setContributionAuthorized(event.target.checked)
              }
              required
            />
            <span>
              I authorize a <strong>${stake} Stripe Sandbox charge</strong> if
              this task fails and the 30-second demo appeal window ends.
            </span>
          </label>
        ) : (
          <div className="consent-note">
            <p>
              Honor-only tasks never charge a card. Paid contributions require
              the assignee to create the task themselves and connect a test card.
            </p>
          </div>
        )}
        <button
          className="primary-button full"
          disabled={busy || (stake > 0 && !contributionAuthorized)}
        >
          {busy ? "Creating…" : "Accept task"}
        </button>
      </form>
    </ModalShell>
  );
}

function ImportNotesModal({
  members,
  openedAt,
  busy,
  close,
  submit,
}: {
  members: Member[];
  openedAt: number;
  busy: boolean;
  close: () => void;
  submit: (payload: Record<string, unknown>) => void;
}) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submit({
      action: "importNotes",
      notes: data.get("notes"),
      dueAt: data.get("dueAt"),
    });
  }

  return (
    <ModalShell close={close} label="Import meeting notes">
      <h2>Turn notes into tasks</h2>
      <p className="modal-intro">
        Put each action item on its own line and name an existing teammate.
        Recognized teammates: {members.map((member) => member.name).join(", ")}.
      </p>
      <form onSubmit={onSubmit}>
        <label>
          Meeting notes or summary
          <textarea
            name="notes"
            rows={8}
            minLength={5}
            maxLength={10_000}
            placeholder={"Maya: Draft the launch email\nTheo will test checkout\nJiyun — Summarize customer feedback"}
            required
            autoFocus
          />
        </label>
        <label>
          Default deadline for these tasks
          <input
            type="datetime-local"
            name="dueAt"
            min={localDateTimeValue(new Date(openedAt + 5 * 60 * 1000))}
            max={localDateTimeValue(
              new Date(openedAt + 30 * 24 * 60 * 60 * 1000),
            )}
            defaultValue={localDateTimeValue(
              new Date(openedAt + 3 * 24 * 60 * 60 * 1000),
            )}
            required
          />
        </label>
        <div className="privacy-note">
          <p>
            The original notes are not stored. Only the recognized task,
            owner, and deadline are saved.
          </p>
        </div>
        <button className="primary-button full" disabled={busy}>
          {busy ? "Creating…" : "Create assigned tasks"}
        </button>
      </form>
    </ModalShell>
  );
}

function ReviewModal({
  pact,
  member,
  busy,
  close,
  decide,
}: {
  pact: Pact;
  member: Member;
  busy: boolean;
  close: () => void;
  decide: (decision: "approve" | "reject") => void;
}) {
  return (
    <ModalShell close={close} label={`Review ${pact.title}`}>
      <h2>{pact.title}</h2>
      <div className="submission-by">
        <span className="avatar small">
          {member.initials}
        </span>
        <span>Submitted by <strong>{member.name}</strong></span>
      </div>
      <div className="submitted-work">
        <div>
          <strong>Submitted work</strong>
          {pact.submission_url ? (
            <a
              href={pact.submission_url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open submitted work
            </a>
          ) : (
            <span>No work link attached</span>
          )}
        </div>
        <p>{pact.submission_note || "Ready for review."}</p>
      </div>
      <div className="review-checklist">
        {pact.criteria.map((criterion) => (
          <label key={criterion}>
            <input type="checkbox" defaultChecked />
            <span>{criterion}</span>
          </label>
        ))}
      </div>
      <div className="vote-meter">
        <span>{pact.approvals} approve</span>
        <span>{pact.rejections} reject</span>
        <strong>2 votes decide</strong>
      </div>
      <div className="modal-actions">
        <button className="outline-button" disabled={busy} onClick={() => decide("reject")}>
          Needs another pass
        </button>
        <button className="primary-button" disabled={busy} onClick={() => decide("approve")}>
          Approve work
        </button>
      </div>
      <p className="fine-print">
        A second rejection starts a 30-second appeal window before the authorized{" "}
        {money(pact.stake_cents)} Stripe Sandbox charge.
      </p>
    </ModalShell>
  );
}

function SubmitModal({
  pact,
  busy,
  close,
  submit,
}: {
  pact: Pact;
  busy: boolean;
  close: () => void;
  submit: (note: string, workUrl: string) => void;
}) {
  const [note, setNote] = useState("");
  const [workUrl, setWorkUrl] = useState("");
  return (
    <ModalShell close={close} label={`Submit ${pact.title}`}>
      <h2>Mark it ready</h2>
      <p className="modal-intro">{pact.title}</p>
      <div className="review-checklist compact">
        {pact.criteria.map((criterion) => (
          <label key={criterion}>
            <input type="checkbox" defaultChecked />
            <span>{criterion}</span>
          </label>
        ))}
      </div>
      <label>
        Link to completed work
        <input
          type="url"
          value={workUrl}
          placeholder="https://..."
          onChange={(event) => setWorkUrl(event.target.value)}
          required
        />
      </label>
      <label>
        Note for reviewers
        <textarea
          rows={4}
          value={note}
          placeholder="What changed? Where should they look?"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button
        className="primary-button full"
        disabled={busy || !workUrl.trim()}
        onClick={() => submit(note, workUrl)}
      >
        {busy ? "Sending…" : "Send to review"}
      </button>
    </ModalShell>
  );
}

function AppealModal({
  pact,
  openedAt,
  busy,
  close,
  submit,
}: {
  pact: Pact;
  openedAt: number;
  busy: boolean;
  close: () => void;
  submit: (payload: Record<string, unknown>) => void;
}) {
  const isChargeAppeal =
    pact.status === "failed" && pact.contribution_status === "pending";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submit({
      action: "appeal",
      pactId: pact.id,
      category: data.get("category"),
      note: data.get("note"),
      requestedDueAt: data.get("requestedDueAt"),
    });
  }

  return (
    <ModalShell close={close} label={`Request more time for ${pact.title}`}>
      <h2>{isChargeAppeal ? "Appeal the test charge" : "Request an extension"}</h2>
      <p className="modal-intro">
        {isChargeAppeal
          ? "The scheduled Stripe test charge pauses immediately while another teammate reviews your request."
          : "A health or family emergency can happen. The deadline pauses while another teammate reviews this request."}
      </p>
      <form onSubmit={onSubmit}>
        <label>
          General reason
          <select name="category" defaultValue="family">
            <option value="health">Health emergency</option>
            <option value="family">Family emergency</option>
            <option value="other">Other urgent situation</option>
          </select>
        </label>
        <label>
          Requested new deadline
          <input
            type="datetime-local"
            name="requestedDueAt"
            min={localDateTimeValue(new Date(openedAt + 5 * 60 * 1000))}
            max={localDateTimeValue(
              new Date(openedAt + 14 * 24 * 60 * 60 * 1000),
            )}
            defaultValue={localDateTimeValue(
              new Date(openedAt + 48 * 60 * 60 * 1000),
            )}
            required
          />
        </label>
        <label>
          Optional context
          <textarea
            name="note"
            rows={3}
            maxLength={280}
            placeholder="Share only what helps the team make a fair decision."
          />
        </label>
        <div className="privacy-note">
          <p>No documents, diagnosis, or private medical details are required.</p>
        </div>
        <button className="primary-button full" disabled={busy}>
          {busy
            ? "Sending…"
            : isChargeAppeal
              ? "Pause charge and appeal"
              : "Send compassionate appeal"}
        </button>
        <p className="fine-print">
          {isChargeAppeal
            ? "This is a 30-second Sandbox demo window. Production would use a longer policy."
            : "Appeals can be requested during the 24-hour deadline grace period."}
        </p>
      </form>
    </ModalShell>
  );
}

function ResolveAppealModal({
  pact,
  appeal,
  member,
  busy,
  close,
  decide,
}: {
  pact: Pact;
  appeal: Appeal;
  member: Member;
  busy: boolean;
  close: () => void;
  decide: (decision: "approve" | "reject") => void;
}) {
  const category =
    appeal.category === "health"
      ? "Health emergency"
      : appeal.category === "family"
        ? "Family emergency"
        : "Other urgent situation";
  const isChargeAppeal = pact.contribution_status === "paused";

  return (
    <ModalShell close={close} label={`Review appeal for ${pact.title}`}>
      <h2>{pact.title}</h2>
      <div className="submission-by">
        <span className="avatar small">
          {member.initials}
        </span>
        <span>
          Requested by <strong>{member.name}</strong>
        </span>
      </div>
      <div className="appeal-summary">
        <span>
          <small>Reason</small>
          <strong>{category}</strong>
        </span>
        <span>
          <small>Original</small>
          <strong>{pact.due_label}</strong>
        </span>
        <span>
          <small>Requested</small>
          <strong>
            {new Date(appeal.requested_due_at).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </strong>
        </span>
      </div>
      {appeal.note && <blockquote>{appeal.note}</blockquote>}
      <p className="modal-intro">
        Decide using only the information they chose to share. No proof is
        required.
      </p>
      <div className="modal-actions">
        <button
          className="outline-button"
          disabled={busy}
          onClick={() => decide("reject")}
        >
          {isChargeAppeal ? "Resume test charge" : "Keep original deadline"}
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => decide("approve")}
        >
          {isChargeAppeal ? "Approve appeal and reset task" : "Approve extension"}
        </button>
      </div>
    </ModalShell>
  );
}

function UpgradeModal({
  close,
}: {
  close: () => void;
}) {
  return (
    <ModalShell close={close} label="Upgrade Launch Club">
      <span className="plan-sticker">Stripe test subscription</span>
      <h2>Upgrade the team</h2>
      <div className="price-row">
        <strong>$12</strong>
        <span>/ team<br />/ month</span>
      </div>
      <ul className="plan-list">
        <li>Unlimited teammates and tasks</li>
        <li>Custom voting rules and appeals</li>
        <li>Project history and contribution reports</li>
        <li>Multiple communal goals</li>
      </ul>
      <a
        className="primary-button full checkout-link"
        href="https://buy.stripe.com/test_cNi4grake09B9lP7oL8AE00"
        target="_blank"
        rel="noreferrer"
      >
        Open Stripe test checkout
      </a>
      <p className="fine-print">
        Stripe Sandbox only. Use a Stripe test card—no real charge is made.
      </p>
    </ModalShell>
  );
}

function InviteModal({
  url,
  expiresAt,
  close,
  copied,
}: {
  url: string;
  expiresAt: string;
  close: () => void;
  copied: () => void;
}) {
  async function copy() {
    await navigator.clipboard.writeText(url);
    copied();
  }

  return (
    <ModalShell close={close} label="Invite a teammate">
      <h2>Bring in a teammate</h2>
      <p className="modal-intro">
        Share this single-use link. It expires{" "}
        {new Date(expiresAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}.
      </p>
      <label>
        Team invite link
        <input value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button className="primary-button full" onClick={copy}>
        Copy invite link
      </button>
    </ModalShell>
  );
}
