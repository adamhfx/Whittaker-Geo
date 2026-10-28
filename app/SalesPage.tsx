"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  Menu,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import "./sales.css";

export type SalesPageProps = {
  signedIn: boolean;
  billingEnabled: boolean;
  busy: boolean;
  error: string;
  onSignIn: () => void;
  onWorkspace: () => void;
  onChoosePlan: (interval: "month" | "year") => void;
  accountControls?: ReactNode;
};

const benefits = [
  {
    icon: Save,
    title: "Save inputs and revisions",
    text: "Keep project inputs and scenario revisions together so you can revisit a decision without rebuilding the work.",
  },
  {
    icon: RotateCcw,
    title: "Edit the schedules",
    text: "Work with editable schedules and preserve an immutable run history for every result.",
  },
  {
    icon: Download,
    title: "Export the results",
    text: "Export editable results to Excel when a project review needs a wider workflow.",
  },
];

const faqs = [
  [
    "What is Whittaker Geo?",
    "Whittaker Geo is a focused workspace for running practical calculators with your own inputs, saving private scenarios, and keeping a durable record of each run.",
  ],
  [
    "Which calculators are available?",
    "The library is designed to grow over time. State Rent Economics is the first calculator, and it is currently awaiting model approval before it becomes available for numerical use.",
  ],
  [
    "Will I be charged during prelaunch?",
    "No. Checkout is currently unavailable, and the prices shown are clear prelaunch prices for planning purposes. No payment is taken while billing is unavailable.",
  ],
  [
    "Can I use my saved work later?",
    "Yes. Even after your subscription expires, you can view saved calculations and download completed results. Renew when you want to create, edit, duplicate, or run another scenario.",
  ],
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className={`sales-faq-item${open ? " is-open" : ""}`}>
      <h3>
        <button
          type="button"
          className="sales-faq-question"
          id={`faq-question-${id}`}
          aria-expanded={open}
          aria-controls={`faq-answer-${id}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{question}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </h3>
      <div
        className="sales-faq-answer"
        id={`faq-answer-${id}`}
        role="region"
        aria-labelledby={`faq-question-${id}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="sales-faq-answer-inner">
          <p>{answer}</p>
        </div>
      </div>
    </div>
  );
}

export default function SalesPage({
  signedIn,
  billingEnabled,
  busy,
  error,
  onSignIn,
  onWorkspace,
  onChoosePlan,
  accountControls,
}: SalesPageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash !== "#plans") return;
    const frame = requestAnimationFrame(() => document.getElementById("plans")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const choose = (interval: "month" | "year") => {
    if (busy) return;
    onChoosePlan(interval);
  };

  const navAction = signedIn ? onWorkspace : onSignIn;
  const navLabel = signedIn ? "Open workspace" : "Sign in";

  return (
    <main className="sales-page">
      <div className="sales-grain" aria-hidden="true" />
      <nav className="sales-nav" aria-label="Primary navigation">
        <a className="sales-brand" href={signedIn ? "/workspace" : "#top"} aria-label={signedIn ? "Whittaker Geo overview" : "Whittaker Geo home"}>
          <img src="/whittaker-geo-logo.svg" alt="Whittaker Geo" width="2101" height="360" />
        </a>
        <div
          id="sales-nav-links"
          className={`sales-nav-links ${menuOpen ? "is-open" : ""}`}
        >
          <a href="#why">Why Whittaker Geo</a>
          <a href="#how">How it works</a>
          <a href="#plans">Plans</a>
          <a href="#faq">FAQ</a>
          <button
            className={signedIn ? "sales-nav-workspace" : "sales-nav-mobile-action"}
            onClick={() => {
              navAction();
              setMenuOpen(false);
            }}
          >
            {navLabel}
          </button>
        </div>
        {accountControls ?? (
          <button className="sales-nav-action" onClick={navAction}>
            {navLabel}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        <button
          className="sales-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="sales-nav-links"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </nav>

      <header className="sales-hero" id="top">
        <div className="sales-hero-copy">
          <p className="sales-eyebrow">
            <span className="sales-eyebrow-dot" />
            Project economics, kept clear
          </p>
          <h1>
            Understand your project economics. <em>Keep every scenario.</em>
          </h1>
          <p className="sales-hero-lede">
            Whittaker Geo gives gas and oil development decisions a clear home:
            editable schedules, saved inputs, revisions, and results you can
            take into the wider workflow.
          </p>
          <div className="sales-hero-actions">
            <a className="sales-button sales-button-primary" href="#plans">
              Compare plans <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="sales-text-link" href="/preview">
              See a preview <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p className="sales-microcopy">
            <LockKeyhole size={14} aria-hidden="true" />
            Private by design · No card required during prelaunch
          </p>
        </div>
        <div
          className="sales-hero-art"
          aria-label="A preview of a Whittaker Geo calculator workspace"
        >
          <div className="sales-window-bar">
            <span />
            <span />
            <span />
            <b>WHITTAKER GEO / STATE RENT</b>
          </div>
          <div className="sales-window-body">
            <div className="sales-window-kicker">
              State Rent Economics <span>Awaiting approval</span>
            </div>
            <h2>Make the assumptions visible.</h2>
            <div className="sales-input-lines">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="sales-window-footer">
              <span>Scenario / Gas + oil development</span>
              <strong>
                Save scenario <Save size={13} />
              </strong>
            </div>
          </div>
          <div className="sales-art-note sales-art-note-top">
            Your assumptions, in one place.
          </div>
          <div className="sales-art-note sales-art-note-bottom">
            Inputs → schedules → results
          </div>
        </div>
      </header>

      <section
        className="sales-proof-strip"
        aria-label="Whittaker Geo principles"
      >
        <span>Built for thoughtful decisions</span>
        <i />
        <span>Private scenarios</span>
        <i />
        <span>Traceable runs</span>
        <i />
        <span>Editable exports</span>
      </section>

      <section className="sales-section sales-why" id="why">
        <div className="sales-section-intro">
          <p className="sales-eyebrow">A better project record</p>
          <h2>
            Keep the schedules close.
            <br />
            <em>See each revision</em> clearly.
          </h2>
        </div>
        <div className="sales-section-body">
          <p>
            Development economics change as assumptions change. Whittaker Geo
            gives your inputs, schedules, and outputs enough structure to
            compare scenarios without losing the thread.
          </p>
          <a className="sales-text-link" href="#how">
            See the workflow <ArrowRight size={16} />
          </a>
        </div>
      </section>

      <section className="sales-benefits" aria-label="Product benefits">
        {benefits.map(({ icon: Icon, title, text }, index) => (
          <article className="sales-benefit-card" key={title}>
            <span className="sales-card-index">0{index + 1}</span>
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="sales-section sales-how" id="how">
        <div className="sales-section-intro">
          <p className="sales-eyebrow">How it works</p>
          <h2>
            One clean loop from <em>question</em> to next step.
          </h2>
        </div>
        <div className="sales-process">
          <div className="sales-process-step">
            <span>01</span>
            <div>
              <h3>Choose a model</h3>
              <p>
                Start with a focused calculator built around the project
                economics in front of you.
              </p>
            </div>
          </div>
          <div className="sales-process-step">
            <span>02</span>
            <div>
              <h3>Shape the scenario</h3>
              <p>
                Enter and revise your own values, schedules, and development
                assumptions.
              </p>
            </div>
          </div>
          <div className="sales-process-step">
            <span>03</span>
            <div>
              <h3>Run, review, export</h3>
              <p>
                Compare a durable run history, then bring editable results into
                Excel when you need to.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sales-calculator-callout">
        <div>
          <p className="sales-eyebrow">First in the library</p>
          <h2>State Rent Economics, with room to think.</h2>
          <p>
            State Rent Economics is currently awaiting model approval. It will
            be the first focused calculator in Whittaker Geo, with future models
            joining the same private workspace.
          </p>
        </div>
        <div className="sales-status-card">
          <div className="sales-status-heading">
            <span className="sales-status-dot" />
            In preparation
          </div>
          <div className="sales-status-line">
            <span>Calculator</span>
            <strong>State Rent Economics</strong>
          </div>
          <div className="sales-status-line">
            <span>Scenario</span>
            <strong>Gas + oil development</strong>
          </div>
          <div className="sales-status-line">
            <span>Output</span>
            <strong>Excel export ready</strong>
          </div>
        </div>
      </section>

      <section className="sales-pricing" id="plans">
        <div className="sales-pricing-heading">
          <p className="sales-eyebrow">Simple access</p>
          <h2>Choose your pace.</h2>
          <p>
            One subscription includes every current and future calculator, along
            with the workspace that keeps your thinking together.
          </p>
        </div>
        <p className="sales-saving-note">
          Choose monthly flexibility, or save about 17% with yearly access.
        </p>
        <div className="sales-plan-grid">
          <article className="sales-plan-card">
            <p className="sales-plan-label">Monthly</p>
            <h3>
              $49.99 <small>/ month CAD</small>
            </h3>
            <p className="sales-plan-description">
              Flexible access while you make Whittaker Geo part of your process.
            </p>
            <button
              className="sales-button sales-button-secondary"
              onClick={() => choose("month")}
              disabled={busy}
            >
              {signedIn ? "Choose monthly" : "Sign in to choose"}
              <ArrowRight size={16} />
            </button>
            <p className="sales-plan-footnote">
              Prelaunch price · No payment while checkout is unavailable
            </p>
          </article>
          <article className="sales-plan-card sales-plan-featured">
            <div className="plan-savings-header"><strong>Save 17%</strong><span>with annual billing</span></div>
            <p className="sales-plan-label">Yearly</p>
            <h3>
              $499.99 <small>/ year CAD</small>
            </h3>
            <p className="sales-plan-description">
              The steady choice for a year of decisions, with CAD $99.89 saved
              versus monthly.
            </p>
            <button
              className="sales-button sales-button-primary"
              onClick={() => choose("year")}
              disabled={busy}
            >
              {signedIn ? "Choose yearly" : "Sign in to choose"}
              <ArrowRight size={16} />
            </button>
            <p className="sales-plan-footnote">
              Prelaunch price · No payment while checkout is unavailable
            </p>
          </article>
        </div>
        <div className="sales-billing-notice">
          <FileSpreadsheet size={18} aria-hidden="true" />
          <p>
            <strong>
              {billingEnabled
                ? "Plans are ready to continue."
                : "Checkout is currently unavailable."}
            </strong>{" "}
            {billingEnabled
              ? "Select a plan to continue to the next step."
              : "These are clear prelaunch prices for planning. No card is requested and you will not be charged."}
          </p>
        </div>
      </section>

      <section className="sales-includes" aria-labelledby="sales-includes-title">
        <h2 className="sales-includes-title" id="sales-includes-title">Every plan includes</h2>
        <ul className="sales-includes-grid">
          {[
            "All current and future calculators",
            "Private saved scenarios",
            "Immutable run history",
            "Editable Excel values exports",
          ].map((item) => (
            <li key={item}>
              <Check size={24} aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="sales-faq" id="faq">
        <div className="sales-section-intro">
          <p className="sales-eyebrow">Questions, answered</p>
          <h2>
            Good decisions deserve
            <br />
            <em>clear terms.</em>
          </h2>
        </div>
        <div className="sales-faq-list">
          {faqs.map(([question, answer]) => (
            <FaqItem key={question} question={question} answer={answer} />
          ))}
        </div>
      </section>

      <section className="sales-final-cta">
        <div>
          <p className="sales-eyebrow">Make the next question easier</p>
          <h2>
            Give your thinking
            <br />
            <em>a place to land.</em>
          </h2>
        </div>
        <button
          className="sales-button sales-button-primary"
          onClick={signedIn ? onWorkspace : onSignIn}
        >
          {signedIn ? "Open your workspace" : "Start with Whittaker Geo"}
          <ArrowRight size={18} />
        </button>
      </section>
      {error && (
        <div className="sales-error" role="alert">
          {error}
        </div>
      )}
      <footer className="sales-footer">
        <a href={signedIn ? "/workspace" : "#top"} aria-label={signedIn ? "Whittaker Geo overview" : "Whittaker Geo home"}><img src="/whittaker-geo-logo.svg" alt="Whittaker Geo" width="2101" height="360" /></a>
        <span>Private tools for considered decisions.</span>
        <span>© Whittaker Geo</span>
      </footer>
    </main>
  );
}
