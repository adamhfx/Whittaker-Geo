"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parsePageRoute, routeHref, type AppRoute } from "@/lib/routes";
import { safeReturnPath } from "@/lib/auth-helpers";
import AccountSettings from "./AccountSettings";
import LoadingSpinner from "./LoadingSpinner";
import { HelpDialog } from "./HelpDialog";
import { LiveCalculation, WorkbookOutputs } from "./LiveCalculation";
import "./model-editor.css";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FlaskConical,
  FolderOpen,
  Gauge,
  History,
  LogOut,
  Plus,
  Pencil,
  Save,
  ShieldCheck,
  Settings,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { browserClient } from "@/lib/browser";
import { initialInputs, validateInputs } from "@/lib/validation";
import type {
  Calculation,
  Field,
  InputValues,
  Manifest,
  Run,
  Result,
} from "@/lib/types";
import { previewManifest } from "./preview/manifest";
import SalesPage from "./SalesPage";
import AdminModels from "./AdminModels";
import { changeInput, inputOptions, isFluidUnit, optionLabel } from "@/lib/input-options";
type CatalogItem = {
  id: string;
  name: string;
  description: string;
  current_version: string;
};
type Workspace = {
  user: { email: string; name?: string | null; avatarUrl?: string | null; isAdmin?: boolean };
  canWrite: boolean;
  billingEnabled: boolean;
  subscription: {
    status: string;
    paid_until: string | null;
    cancel_at_period_end: boolean;
    interval?: string | null;
  } | null;
  calculations: Calculation[];
  calculators: CatalogItem[];
};
type View = "overview" | "saved" | "catalog" | "editor" | "results" | "billing" | "models" | "settings";
const usd = (v: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    currencyDisplay: "code",
  }).format(v);
const when = (v: string) =>
  new Date(v).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
function Brand({ href = "/", onNavigate }: { href?: string; onNavigate?: () => void }) {
  return (
    <div className="brand">
      <a className="brand-link" href={href} aria-label={href === "/" ? "Whittaker Geo home" : "Whittaker Geo overview"} onClick={(event) => {
        if (onNavigate && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
          event.preventDefault();
          onNavigate();
        }
      }}>
      <img
        className="logo-full"
        src="/whittaker-geo-logo.png"
        alt="Whittaker Geo"
        width="2172"
        height="724"
      />
      <img
        className="logo-compact"
        src="/whittaker-geo-icon.png"
        alt="Whittaker Geo"
        width="1280"
        height="1280"
      />
      </a>
    </div>
  );
}

export default function App({ preview = false }: { preview?: boolean }) {
  const [entry, setEntry] = useState<"sales" | "signin" | "workspace">("sales");
  const [showPlans, setShowPlans] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"month" | "year" | null>(
    null,
  );
  useEffect(() => {
    if (entry === "sales" && window.location.hash === "#plans") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [entry]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [routeLoading, setRouteLoading] = useState(true);
  const [routeError, setRouteError] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const loadedEntity = useRef("");
  const inputPanelRef = useRef<HTMLDivElement>(null);
  const currentRoute = parsePageRoute(pathname, search);
  function navigate(route: AppRoute, replace = false) {
    const href = routeHref(route);
    // Native history updates Next's location hooks without remounting the shell.
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    if (!(route.view === "editor" && view === "editor")) window.scrollTo({ top: 0, behavior: "instant" });
  }
  function setView(next: View) {
    navigate({ view: next, preview,
      ...(next === "editor" ? calculation ? { calculationId: calculation.id, section: group } : { calculatorId: manifest?.id || chosen, mode: currentRoute?.mode || "example", section: group } : {}),
      ...(next === "results" && selectedRun ? { calculationId: selectedRun.calculation_id, runId: selectedRun.id } : {}),
    });
  }
  function signOut() {
    return perform(async () => {
      const { error } = await browserClient().auth.signOut();
      if (error) throw error;
      try { for (const key of Object.keys(sessionStorage)) if (key.startsWith("geoflow-draft:")) sessionStorage.removeItem(key); } catch {}
      setWorkspace(null);
      setSelectedPlan(null);
      router.replace("/");
    });
  }
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(!preview),
    [view, setViewState] = useState<View>("overview");
  const [manifest, setManifest] = useState<Manifest | null>(
      preview ? (previewManifest as unknown as Manifest) : null,
    ),
    [approved, setApproved] = useState(false);
  const [localModelReview, setLocalModelReview] = useState(false);
  const [calculation, setCalculation] = useState<Calculation | null>(null),
    [inputs, setInputs] = useState<InputValues>({}),
    [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({}),
    [name, setName] = useState(""),
    [group, setGroup] = useState("reservoir");
  const [runs, setRuns] = useState<Run[]>([]),
    [selectedRun, setSelectedRun] = useState<Run | null>(null),
    [modal, setModal] = useState(false),
    [chosen, setChosen] = useState("state-rent");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
    setLocalModelReview(
      preview &&
        process.env.NODE_ENV === "development" &&
        process.env.NEXT_PUBLIC_LOCAL_MODEL_REVIEW === "true" &&
        loopbackHosts.has(window.location.hostname.toLowerCase()),
    );
  }, [preview]);
  const isLocalModelReview = preview && localModelReview;
  const submitting = useRef(false),
    submission = useRef<{ revision: number; key: string } | null>(null);
  const request = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      const data = await response.json();
      if (response.status === 401) setWorkspace(null);
      if (!response.ok)
        throw new Error(data.error || "The request could not be completed.");
      return data;
    },
    [],
  );
  const refresh = useCallback(async () => {
    if (preview) return;
    try {
      setWorkspace(await request("/api/bootstrap"));
      setError("");
    } catch (e) {
      if (e instanceof Error && !e.message.includes("sign in"))
        setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [preview, request]);
  useEffect(() => {
    if (preview) return;
    // The public landing page also works before sign-in is configured.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setLoading(false);
      return;
    }
    refresh();
    const { data } = browserClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setWorkspace(null);
        setViewState("overview");
        setEntry("sales");
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")
        setTimeout(() => void refresh(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [preview, refresh]);
  useEffect(() => {
    if (!selectedRun || !["queued", "running"].includes(selectedRun.status))
      return;
    const id = selectedRun.id;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const { run } = await request("/api/runs/" + id);
        if (!cancelled) {
          setSelectedRun(run);
          setRuns((old) => old.map((r) => (r.id === id ? run : r)));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [selectedRun?.id, selectedRun?.status, request]);
  const editable = preview || !!workspace?.canWrite;
  const catalog: CatalogItem[] = preview
    ? [
        {
          id: "state-rent",
          name: previewManifest.name,
          description: previewManifest.description,
          current_version: previewManifest.version,
        },
      ]
    : workspace?.calculators || [];
  async function perform(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  async function loadManifest(id: string, version?: string) {
    if (preview)
      return {
        manifest: previewManifest as unknown as Manifest,
        approved: false,
      };
    return request(
      "/api/calculators/" +
        encodeURIComponent(id) +
        (version ? "?version=" + encodeURIComponent(version) : ""),
    );
  }
  useEffect(() => {
    if (loading) return;
    const entity = currentRoute && (preview ? "preview" : workspace?.user.email) + ":" +
      (currentRoute.calculationId || `new:${currentRoute.calculatorId}:${currentRoute.mode || "blank"}`);
    // A section address change needs no data reload or temporary loading screen.
    // Keep the editor, live results, and their scroll positions mounted.
    if (currentRoute?.view === "editor" && view === "editor" && manifest &&
        (preview || workspace) && loadedEntity.current === entity) {
      setGroup(manifest.groups.some(g => g.id === currentRoute.section) ? currentRoute.section! : manifest.groups[0].id);
      setRouteError("");
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    setRouteError("");
    setModal(false);
    async function openRoute() {
      const route = currentRoute;
      if (!route) throw new Error("This page could not be found.");
      const plan = searchParams.get("plan");
      if (plan === "month" || plan === "year") setSelectedPlan(plan);
      const wantsSignIn = route.view === "signin" || searchParams.has("signin") || searchParams.has("error");
      if (!preview && !workspace) {
        setEntry(route.view === "sales" && !wantsSignIn ? "sales" : "signin");
        return;
      }
      if (route.view === "sales" || route.view === "signin") {
        let returnTo = searchParams.get("next");
        try {
          returnTo ||= sessionStorage.getItem("geoflow-return-to");
          sessionStorage.removeItem("geoflow-return-to");
          const priorPlan = sessionStorage.getItem("geoflow-selected-plan");
          sessionStorage.removeItem("geoflow-selected-plan");
          if (priorPlan === "month" || priorPlan === "year") {
            setSelectedPlan(priorPlan);
            returnTo ||= "/subscription?plan=" + priorPlan;
          }
        } catch {}
        const safeNext = safeReturnPath(returnTo);
        if (safeNext !== "/" && !safeNext.startsWith("/signin")) { router.replace(safeNext); return; }
        if (route.view === "signin" || (workspace?.canWrite && window.location.hash !== "#plans")) { router.replace("/workspace"); return; }
        setEntry("sales");
        setShowPlans(window.location.hash === "#plans");
        return;
      }
      setEntry("workspace");
      setShowPlans(false);
      try {
        sessionStorage.removeItem("geoflow-return-to");
        sessionStorage.removeItem("geoflow-selected-plan");
      } catch {}
      if ((route.view === "models" && !workspace?.user.isAdmin) || (preview && route.view === "settings"))
        throw new Error("This page is not available for this account.");
      if (route.view !== "editor" && route.view !== "results") {
        setViewState(route.view);
        return;
      }
      const entity = (preview ? "preview" : workspace!.user.email) + ":" + (route.calculationId || `new:${route.calculatorId}:${route.mode || "blank"}`);
      const key = "geoflow-draft:" + entity;
      let m = manifest;
      if (loadedEntity.current !== entity) {
        let c: Calculation | null = null;
        let history: Run[] = [];
        if (route.calculationId) {
          if (preview) throw new Error("Saved calculations are available in your signed-in workspace.");
          const detail = await request("/api/calculations/" + route.calculationId);
          c = detail.calculation;
          history = detail.runs;
        }
        const model = await loadManifest(c?.calculator_id || route.calculatorId!, c?.calculator_version);
        if (cancelled) return;
        m = model.manifest;
        let draft: { name: string; inputs: InputValues; version: string; revision?: number; group?: string } | null = null;
        try { draft = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
        if (draft && (draft.version !== m!.version || (c && draft.revision !== c.revision) || typeof draft.name !== "string" || !draft.inputs || Array.isArray(draft.inputs) || typeof draft.inputs !== "object" || Object.values(draft.inputs).some(value => value !== null && typeof value !== "string" && typeof value !== "number"))) draft = null;
        setCalculation(c);
        setManifest(m);
        setApproved(model.approved);
        setRuns(history);
        setSelectedRun(null);
        setName(draft?.name ?? c?.name ?? (route.mode === "example" ? m!.name + " example" : "Untitled calculation"));
        setNumericDrafts({});
        setInputs(draft?.inputs ?? c?.inputs ?? initialInputs(m!, route.mode || "blank"));
        setDirty(!!draft || !c);
        setDraftKey(key);
        loadedEntity.current = entity;
        submission.current = null;
        setNotice(draft ? "Restored your unsaved inputs from this browser session." : "");
      }
      if (cancelled) return;
      if (route.view === "editor") setGroup(m!.groups.some(g => g.id === route.section) ? route.section! : m!.groups[0].id);
      if (route.view === "results") {
        const data = await request("/api/runs/" + route.runId);
        if (cancelled) return;
        if (data.run.calculation_id !== route.calculationId) throw new Error("This result does not belong to this calculation.");
        setSelectedRun(data.run);
      }
      setViewState(route.view);
    }
    openRoute().catch(e => { if (!cancelled) setRouteError(e instanceof Error ? e.message : "Unable to open this page."); }).finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  // Data is reopened only when the address or signed-in account changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, loading, workspace?.user.email, preview]);

  useEffect(() => {
    if (routeLoading || !draftKey || !manifest || !dirty || view !== "editor") return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ name, inputs, version: manifest.version, revision: calculation?.revision })); } catch {}
  }, [inputs, name, dirty, draftKey, routeLoading, manifest, calculation?.revision, view]);

  async function startNew(mode: "example" | "blank") {
    loadedEntity.current = "";
    const key = "geoflow-draft:" + (preview ? "preview" : workspace?.user.email) + `:new:${chosen}:${mode}`;
    try { sessionStorage.removeItem(key); } catch {}
    setModal(false);
    const route: AppRoute = { view: "editor", preview, calculatorId: chosen, mode };
    const href = routeHref(route);
    if (pathname + (search ? "?" + search : "") === href) window.location.assign(href);
    else navigate(route);
  }
  async function openCalculation(c: Calculation) {
    navigate({ view: "editor", preview, calculationId: c.id });
  }
  useEffect(() => {
    // Start the newly selected inputs at the top of their own pane, without moving the page.
    inputPanelRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [group]);

  function selectInputSection(section: string) {
    if (!currentRoute || group === section) return;
    navigate({ ...currentRoute, section });
  }
  function updateInput(id: string, value: string | number | null) {
    setInputs((old) => changeInput(manifest, old, id, value));
    if (manifest && inputs[id] !== value && (manifest.fields.some((field) => field.dependsOn === id) || (manifest.id === "state-rent" && id === "C5")))
      setNotice("Choose units for the selected fluid and review the volume and flow rate amounts. Numeric values have not been converted.");
    setDirty(true);
  }
  function updateNumericDraft(id: string, rawValue: string) {
    setNumericDrafts((old) => ({ ...old, [id]: rawValue }));
    const trimmed = rawValue.trim();
    if (!trimmed) {
      updateInput(id, null);
      return;
    }
    const isDecimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed);
    const parsed = Number(trimmed);
    updateInput(id, isDecimal && Number.isFinite(parsed) ? parsed : rawValue);
  }
  function finishNumericDraft(id: string, rawValue: string) {
    const trimmed = rawValue.trim();
    const isDecimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed);
    if (!trimmed || (isDecimal && Number.isFinite(Number(trimmed)))) {
      setNumericDrafts((old) => {
        if (!(id in old)) return old;
        const next = { ...old };
        delete next[id];
        return next;
      });
    }
  }
  async function saveDraft() {
    if (!manifest) throw new Error("Choose a calculator first.");
    if (!workspace?.canWrite)
      throw new Error("An active subscription is required to save changes.");
    if (!name.trim()) throw new Error("Give this calculation a name.");
    const errors = validateInputs(inputs, manifest, false);
    if (errors.length) throw new Error(errors.slice(0, 3).join(" "));
    if (calculation && !dirty) return calculation;
    const data = await request(
      "/api/calculations" + (calculation ? "/" + calculation.id : ""),
      {
        method: calculation ? "PATCH" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          inputs,
          calculatorId: manifest.id,
          version: manifest.version,
          revision: calculation?.revision,
        }),
      },
    );
    setCalculation(data.calculation);
    setDirty(false);
    setWorkspace((old) =>
      old
        ? {
            ...old,
            calculations: [
              data.calculation,
              ...old.calculations.filter((c) => c.id !== data.calculation.id),
            ],
          }
        : old,
    );
    try { if (draftKey) sessionStorage.removeItem(draftKey); } catch {}
    navigate({ view: "editor", preview, calculationId: data.calculation.id, section: group }, true);
    setNotice("Inputs saved. Earlier completed runs are unchanged.");
    return data.calculation as Calculation;
  }
  async function runCalculation() {
    await perform(async () => {
      if (!manifest || !approved)
        throw new Error("This calculator is awaiting numerical approval.");
      const errors = validateInputs(inputs, manifest, true);
      if (errors.length) throw new Error(errors.slice(0, 4).join(" "));
      const c = await saveDraft();
      if (!submission.current || submission.current.revision !== c.revision)
        submission.current = { revision: c.revision, key: crypto.randomUUID() };
      const { run } = await request("/api/calculations/" + c.id + "/runs", {
        method: "POST",
        headers: { "Idempotency-Key": submission.current.key },
        body: JSON.stringify({ revision: c.revision }),
      });
      setRuns((old) => [run, ...old.filter((r) => r.id !== run.id)]);
      setSelectedRun(run);
      navigate({ view: "results", preview, calculationId: run.calculation_id, runId: run.id });
      submission.current = null;
    });
  }
  async function duplicate() {
    await perform(async () => {
      if (!calculation) return;
      const { calculation: c } = await request(
        "/api/calculations/" + calculation.id + "/duplicate",
        { method: "POST" },
      );
      setWorkspace((old) =>
        old ? { ...old, calculations: [c, ...old.calculations] } : old,
      );
      setCalculation(c);
      setName(c.name);
      setNumericDrafts({});
      setInputs(c.inputs);
      setRuns([]);
      setSelectedRun(null);
      setDirty(false);
      submission.current = null;
      navigate({ view: "editor", preview, calculationId: c.id });
      setNotice("Created an independent copy of the saved inputs.");
    });
  }
  async function download(run: Run) {
    await perform(async () => {
      const { url } = await request("/api/runs/" + run.id + "/download");
      window.location.assign(url);
    });
  }
  async function selectRun(run: Run) {
    navigate({ view: "results", preview, calculationId: run.calculation_id || calculation!.id, runId: run.id });
  }
  async function billing(action: "portal" | "month" | "year") {
    await perform(async () => {
      const { url } = await request(
        "/api/billing/" + (action === "portal" ? "portal" : "checkout"),
        {
          method: "POST",
          body:
            action === "portal"
              ? undefined
              : JSON.stringify({ interval: action }),
        },
      );
      window.location.assign(url);
    });
  }
  const accountControls =
    workspace && !preview ? (
      <AccountControls
        user={workspace.user}
        busy={busy}
        onSettings={() => setView("settings")}
        onSignOut={signOut}
      />
    ) : null;
  const workspaceMessages = (
    <>
      {error && (
        <div role="alert" className="notice">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice success">
          {notice}
        </div>
      )}
      {!editable && (
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            Your saved inputs and results remain available. Subscribe to
            create, edit, duplicate, or run calculations.
          </span>
        </div>
      )}
    </>
  );
  const calculationSaveStatus = preview ? "Browser draft" : dirty
    ? (calculation ? "Unsaved changes" : "Not saved yet") : "Saved";
  const isCalculatorWorkspace = currentRoute?.view === "editor" || currentRoute?.view === "results";
  const returnToSaved = !!currentRoute?.calculationId;
  const editorActions = (
    <div className="actions">
      <button
        className="btn"
        disabled={!calculation || !workspace?.canWrite || busy}
        onClick={duplicate}
      >
        <Copy size={16} />
        Duplicate saved inputs
      </button>
      <button
        className="btn"
        disabled={preview || !editable || busy}
        onClick={() =>
          perform(async () => {
            await saveDraft();
          })
        }
      >
        <Save size={16} />
        Save
      </button>
      <button
        className="btn primary"
        disabled={
          preview ||
          !editable ||
          !approved ||
          busy ||
          runs.some((r) => ["queued", "running"].includes(r.status))
        }
        onClick={runCalculation}
      >
        <Zap size={16} />
        Save & run
      </button>
    </div>
  );
  if (loading || (routeLoading && !workspace && !preview))
    return <LoadingSpinner fullPage />;
  if (routeError) return <div className="empty"><Brand /><h1>Unable to open this page</h1><p>{routeError}</p><a className="btn primary" href={preview ? "/preview" : "/workspace"}>Back to workspace</a></div>;
  if (!preview && !workspace && entry !== "sales")
    return (
      <Auth
        error={error}
        plan={selectedPlan}
        returnTo={pathname === "/signin" ? safeReturnPath(searchParams.get("next")) : pathname + (search ? "?" + search : "")}
      />
    );
  if (!preview && (!workspace?.canWrite || showPlans) && entry !== "workspace")
    return (
      <SalesPage
        signedIn={!!workspace}
        billingEnabled={!!workspace?.billingEnabled}
        busy={busy}
        error={error}
        accountControls={accountControls}
        onSignIn={() => {
          setSelectedPlan(null);
          router.push("/signin");
        }}
        onWorkspace={() => {
          setEntry("workspace");
          setView("overview");
        }}
        onChoosePlan={(interval) => {
          setSelectedPlan(interval);
          if (!workspace) {
            router.push("/signin?plan=" + interval + "&next=" + encodeURIComponent("/subscription?plan=" + interval));
            return;
          }
          if (workspace.billingEnabled) {
            void billing(interval);
            return;
          }
          setEntry("workspace");
          router.push("/subscription?plan=" + interval);
          setNotice(
            `You selected the ${interval === "year" ? "annual" : "monthly"} plan. Checkout is not open yet; you have not been charged.`,
          );
        }}
      />
    );
  return (
    <div className={`app${isCalculatorWorkspace ? " app--calculator" : ""}`}>
      {!isCalculatorWorkspace && <aside className="side">
        <Brand href={preview ? "/preview" : "/workspace"} onNavigate={() => setView("overview")} />
        <nav className="nav" aria-label="Main navigation">
          {(
            [
              { id: "overview", label: "Overview", icon: Gauge },
              { id: "saved", label: "Saved Calculations", icon: FolderOpen },
              { id: "catalog", label: "Calculators", icon: FlaskConical },
              { id: "billing", label: "Subscription", icon: Sparkles },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {preview ? (
            <a className="sidebar-plans" href="/signin" aria-label="Sign in">
              <span>Sign in</span><ArrowRight size={18} aria-hidden="true" />
            </a>
          ) : (
            <button
              aria-label="Sign out"
              disabled={busy}
              onClick={signOut}
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </aside>}
      <main className="main">
        {preview && (
          <div className="preview-bar">
            {isLocalModelReview
              ? "LOCAL MODEL REVIEW · Private candidate calculations; changes stay in this browser session"
              : "INTERFACE PREVIEW · Changes stay in this browser session"}
          </div>
        )}
        {isCalculatorWorkspace ? (
          <header className="calculator-toolbar">
            <div className="calculator-toolbar__identity">
              <button className="btn ghost calculator-toolbar__back" onClick={() => setView(returnToSaved ? "saved" : "catalog")}>
                <ArrowLeft size={18} aria-hidden="true" />
                <span>{returnToSaved ? "Saved Calculations" : "Calculators"}</span>
              </button>
              <span className="calculator-toolbar__divider" aria-hidden="true" />
              <img className="calculator-toolbar__mark" src="/whittaker-geo-icon.png" width="34" height="34" alt="" />
              <div className="calculator-toolbar__model">
                <h1>{routeLoading ? "Opening calculator…" : manifest?.name || "Calculator workspace"}</h1>
                <span>{currentRoute?.view === "results" ? "Saved calculation results" : "Calculator workspace"}</span>
              </div>
            </div>
            <div className="calculator-toolbar__actions">
              {currentRoute?.view === "editor" && !routeLoading && editorActions}
              {accountControls}
            </div>
          </header>
        ) : (
          <header className="top">
          <div className="crumb">
            <strong>
              {view === "editor"
                ? "Calculation"
                : view === "results"
                  ? "Results"
                  : view === "catalog"
                    ? "Calculators"
                    : view === "billing"
                      ? "Subscription"
                      : view === "saved" ? "Saved Calculations" : view === "settings" ? "Settings" : view === "models" ? "Calculator workbooks"
                      : "Overview"}
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="btn primary"
              aria-label="New calculation"
              disabled={!editable || busy}
              onClick={() => {
                setChosen(catalog[0]?.id || "state-rent");
                setModal(true);
              }}
            >
              <Plus size={16} />
              <span className="new-calculation-label">New calculation</span>
            </button>
            {accountControls}
          </div>
        </header>
        )}
        <div className={`content${currentRoute?.view === "editor" ? " content--calculator-editor" : ""}`}>
          {routeLoading ? <LoadingSpinner /> : <>
          {view !== "editor" && workspaceMessages}
          {(view === "overview" || view === "saved") && (
            <>
              <div className="eyebrow">{view === "saved" ? "Your project library" : "Economics, with clarity"}</div>
              <h1 className="title">{view === "saved" ? "Saved Calculations" : "Your calculations"}</h1>
              <p className="subtitle">
                {view === "saved" ? "Reopen a saved calculation to review inputs, make changes, or view earlier results." : "Build a scenario. Compare the results. Keep every run."}
              </p>
              {view === "overview" && <div className="metrics">
                <Metric
                  label="Saved calculations"
                  value={String(workspace?.calculations.length || 0)}
                />
                <Metric
                  label="Available calculators"
                  value={String(catalog.length)}
                />
                <Metric
                  label="Workspace access"
                  value={
                    preview
                      ? "Preview"
                      : editable
                        ? "Active subscription"
                        : "View and download"
                  }
                />
              </div>}
              <div className="section-head">
                <h2>Saved projects</h2>
              </div>
              <div className="card">
                {workspace?.calculations.length ? (
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Calculation</th>
                          <th>Last edited</th>
                          <th>Revision</th>
                          <th>Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspace.calculations.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.name}</strong>
                              <div className="small">
                                {catalog.find((m) => m.id === c.calculator_id)
                                  ?.name || c.calculator_id}
                              </div>
                            </td>
                            <td>{when(c.updated_at)}</td>
                            <td>{c.revision}</td>
                            <td>
                              <button
                                className="btn"
                                disabled={busy}
                                aria-label={"Open " + c.name}
                                onClick={() => openCalculation(c)}
                              >
                                <ArrowRight size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    <FolderOpen size={30} />
                    <h3>A place for every scenario</h3>
                    <p>
                      Start with an example or enter your own project
                      assumptions.
                    </p>
                    <button
                      className="btn primary"
                      disabled={!editable}
                      onClick={() => setModal(true)}
                    >
                      <Plus size={16} />
                      Create a calculation
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {view === "catalog" && (
            <>
              <div className="eyebrow">Calculator library</div>
              <h1 className="title">Explore the models</h1>
              <p className="subtitle">
                One subscription includes every current and future calculator.
              </p>
              <div className="catalog-grid" style={{ marginTop: 28 }}>
                {catalog.map((c) => (
                  <article className="card catalog-card" key={c.id}>
                    <div className="catalog-icon">
                      <FlaskConical />
                    </div>
                    <h3>{c.name}</h3>
                    <p>{c.description}</p>
                    <div className="small">
                      Model version {c.current_version}
                    </div>
                    <button
                      className="btn primary"
                      disabled={!editable || busy}
                      onClick={() => {
                        setChosen(c.id);
                        setModal(true);
                      }}
                    >
                      New calculation
                      <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "editor" && manifest && (
            <>
              <div className="calculator-context">
                <div className="calculator-context__name">
                  <div className="calculator-context__name-heading">
                    <label className="form-label" htmlFor="calculation-name">Calculation name</label>
                    <p className="calculator-name-help" id="calculation-name-help">
                      {editable ? "Click to rename" : "Saved calculation"}
                    </p>
                    <span className="calculator-save-status" role="status" aria-label={`Save status: ${calculationSaveStatus}`}>{calculationSaveStatus}</span>
                  </div>
                  <div className="calculator-name-control">
                    <input
                      id="calculation-name"
                      className="text-input project-title"
                      aria-describedby="calculation-name-help"
                      maxLength={120}
                      disabled={!editable}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setDirty(true);
                      }}
                    />
                    {editable && <Pencil className="calculator-name-control__icon" size={17} aria-hidden="true" />}
                  </div>
                </div>
                <p className="calculator-context__description">{manifest.description}</p>
              </div>
              {workspaceMessages}
              {!approved && !isLocalModelReview && (
                <div className="notice">
                  This model is under numerical review. Live calculations will
                  be available after approval.
                </div>
              )}
              <nav className="calculator-section-nav" aria-label="Input sections">
                {manifest.groups.map((g) => (
                  <button
                    key={g.id}
                    className={g.id === group ? "active" : ""}
                    aria-current={g.id === group ? "true" : undefined}
                    onClick={() => selectInputSection(g.id)}
                  >
                    {g.name}
                  </button>
                ))}
              </nav>
              <div className={manifest.outputViews?.length ? "model-workbench" : undefined}>
              <div className="form-layout" id="calculator-input-panel" ref={inputPanelRef}>
                <section className="card group-card">
                  <div className="model-section-heading">
                    <h3>{manifest.groups.find((g) => g.id === group)?.name}</h3>
                    {manifest.groups.find((g) => g.id === group)?.help && <HelpDialog {...manifest.groups.find((g) => g.id === group)!.help!} />}
                  </div>
                  {group === "schedule" ? (
                    <Schedule
                      fields={manifest.fields.filter((f) => f.group === group)}
                      inputs={inputs}
                      setValue={updateInput}
                      numericDrafts={numericDrafts}
                      setNumericDraft={updateNumericDraft}
                      finishNumericDraft={finishNumericDraft}
                      disabled={!editable}
                    />
                  ) : (
                    <div className="field-grid">
                      {manifest.fields
                        .filter((f) => f.group === group)
                        .map((f) => (
                          <Input
                            key={f.id}
                            field={f}
                            options={inputOptions(manifest, f, inputs)}
                            help={isFluidUnit(manifest, f) && !(f.dependsOn ? inputs[f.dependsOn] : inputs.C5) ? "Choose a primary reservoir fluid first." : undefined}
                            value={inputs[f.id]}
                            setValue={(v) => updateInput(f.id, v)}
                            numericDraft={numericDrafts[f.id]}
                            setNumericDraft={(raw) => updateNumericDraft(f.id, raw)}
                            finishNumericDraft={(raw) => finishNumericDraft(f.id, raw)}
                            disabled={!editable}
                          />
                        ))}
                    </div>
                  )}
                  <p className="small" style={{ marginTop: 24 }}>
                    Project amounts use USD.
                  </p>
                </section>
              </div>
              {manifest.outputViews?.length ? <aside className="model-live-panel">
                <LiveCalculation manifest={manifest} inputs={inputs}
                  enabled={isLocalModelReview || (!preview && !!workspace?.canWrite && approved)}
                  endpoint={isLocalModelReview ? "/api/local-model-review" : undefined}
                  reviewMode={isLocalModelReview}
                  blockedReason={!approved ? "This model is awaiting numerical approval. You can explore the inputs and guide notes now." : preview ? "Sign in to calculate with your own inputs." : "An active subscription is required for live calculations."} />
              </aside> : null}
              </div>
              <details className="calculator-history">
                <summary><History size={17} aria-hidden="true" /><span>Run history</span><span className="calculator-history__count">{runs.length} {runs.length === 1 ? "run" : "runs"}</span></summary>
                <section className="card group-card">
                  {runs.length ? (
                    <div className="table-scroll">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Submitted</th>
                            <th>Input revision</th>
                            <th>Status</th>
                            <th>Results</th>
                            <th>Export</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runs.map((r) => (
                            <tr key={r.id}>
                              <td>{when(r.created_at)}</td>
                              <td>{r.calculation_revision}</td>
                              <td>
                                <span className="tag">{r.status}</span>
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  onClick={() => selectRun(r)}
                                >
                                  View run
                                </button>
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  aria-label={
                                    "Download run " + when(r.created_at)
                                  }
                                  disabled={busy || r.status !== "succeeded"}
                                  onClick={() => download(r)}
                                >
                                  <Download size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="subtitle">
                      Completed runs will appear here. Editing inputs never
                      replaces earlier results.
                    </p>
                  )}
                </section>
              </details>
            </>
          )}
          {view === "results" && selectedRun && (
            <Results
              tab={currentRoute?.section === "detail" || currentRoute?.section === "inputs" ? currentRoute.section : "summary"}
              setTab={(section) => currentRoute && navigate({ ...currentRoute, section })}
              run={selectedRun}
              busy={busy}
              manifest={manifest}
              back={() => setView("editor")}
              download={() => download(selectedRun)}
            />
          )}
          {view === "billing" && (
            <>
              <div className="eyebrow">Your subscription</div>
              <h1 className="title">Every model. One workspace.</h1>
              <p className="subtitle">
                All current and future calculators, saved scenarios, and
                editable result exports.
              </p>
              {workspace?.subscription && (
                <div className="notice">
                  {workspace.subscription.interval === "complimentary"
                    ? "Complimentary access · No payment required"
                    : `Status: ${workspace.subscription.status}`}
                  {workspace.subscription.paid_until &&
                  workspace.subscription.interval !== "complimentary"
                    ? " · Paid through " +
                      when(workspace.subscription.paid_until)
                    : ""}
                  {workspace.subscription.cancel_at_period_end
                    ? " · Cancels at the end of this period"
                    : ""}
                </div>
              )}
              <div className="billing-grid">
                {(["month", "year"] as const).map((interval) => (
                  <div className={`card plan${interval === "year" ? " plan-annual" : ""}`} key={interval}>
                    {interval === "year" && <div className="plan-savings-header"><Sparkles size={18} aria-hidden="true" /><strong>Save 17%</strong><span>with annual billing</span></div>}
                    <span className="tag">
                      {interval === "month" ? "Monthly" : "Annual"}
                      {selectedPlan === interval && " · Selected"}
                    </span>
                    <div className="price">
                      {interval === "month" ? "$49.99" : "$499.99"}
                      <span> / {interval} CAD</span>
                    </div>
                    <p className="subtitle">
                      {interval === "year" ? "Save CAD $99.89 a year compared with monthly billing." : "One account. Full calculator access."}
                    </p>
                    <button
                      className="btn primary"
                      disabled={
                        !workspace?.billingEnabled ||
                        busy ||
                        !!workspace?.canWrite
                      }
                      onClick={() => billing(interval)}
                    >
                      Choose {interval === "month" ? "monthly" : "annual"}
                    </button>
                  </div>
                ))}
              </div>
              {!workspace?.billingEnabled && (
                <div className="notice">
                  Checkout is not available yet. Prices are shown in Canadian
                  dollars.
                </div>
              )}
              <button
                className="btn"
                style={{ marginTop: 20 }}
                disabled={!workspace?.billingEnabled || busy}
                onClick={() => billing("portal")}
              >
                Manage billing
              </button>
              <p className="small">
                After your subscription ends, you can still view and download
                saved results.
              </p>
            </>
          )}
          {view === "settings" && workspace && <AccountSettings user={workspace.user} busy={busy} onModels={() => setView("models")} onSubscription={() => setView("billing")} onSignOut={signOut} />}
          {view === "models" && workspace?.user.isAdmin && <AdminModels onBack={() => setView("overview")} />}
          </>}
        </div>
      </main>
      {modal && (
        <div className="modal-shade">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-title"
            className="modal"
          >
            <div className="row">
              <h2 id="new-title">New calculation</h2>
              <button
                className="btn ghost"
                aria-label="Close"
                onClick={() => setModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label htmlFor="calculator" className="form-label">
              Calculator
            </label>
            <select
              id="calculator"
              className="select"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p style={{ marginTop: 20 }}>
              Start with example values, or leave project inputs blank while
              keeping standard lookup assumptions.
            </p>
            <div className="modal-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => startNew("blank")}
              >
                Blank inputs
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => startNew("example")}
              >
                Use example
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AccountControls({
  user,
  busy,
  onSettings,
  onSignOut,
}: {
  user: Workspace["user"];
  busy: boolean;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const initials = (user.name || user.email)
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="account-controls">
      <button
        className="account-avatar-fallback"
        aria-label={`Account: ${user.name || user.email}`}
        onClick={onSettings}
      >
        {user.avatarUrl && !photoFailed ? (
          <img
            className="account-avatar"
            src={user.avatarUrl}
            alt="Your profile"
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          initials
        )}
      </button>
      <button
        className="account-icon"
        aria-label="Settings"
        title="Settings"
        onClick={onSettings}
      >
        <Settings size={19} />
      </button>
      <button
        className="account-icon"
        aria-label="Sign out"
        title="Sign out"
        disabled={busy}
        onClick={onSignOut}
      >
        <LogOut size={19} />
      </button>

    </div>
  );
}

function Auth({
  error: outerError,
  plan,
  returnTo,
}: {
  error: string;
  plan: "month" | "year" | null;
  returnTo: string;
}) {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("error"))
      setError(
        "This sign-in link is invalid or expired. Request a new link below.",
      );
  }, []);
  const [email, setEmail] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signIn(provider: "google" | "email") {
    setBusy(true);
    setError("");
    try {
      const auth = browserClient().auth;
      const callback = new URL("/auth/callback", window.location.origin);
      document.cookie = `geoflow-return-path=${encodeURIComponent(safeReturnPath(returnTo))}; Path=/; Max-Age=600; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
      try {
        sessionStorage.setItem("geoflow-return-to", safeReturnPath(returnTo));
        if (plan) sessionStorage.setItem("geoflow-selected-plan", plan);
        else sessionStorage.removeItem("geoflow-selected-plan");
      } catch {
        /* Sign-in still works when optional storage is unavailable. */
      }
      const result =
        provider === "google"
          ? await auth.signInWithOAuth({
              provider: "google",
              options: {
                redirectTo: callback.toString(),
              },
            })
          : await auth.signInWithOtp({
              email,
              options: {
                emailRedirectTo: callback.toString(),
              },
            });
      if (result.error) throw result.error;
      if (provider === "email")
        setStatus("Check your inbox for your secure sign-in link.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card card">
        <div className="auth-header">
          <Brand />
        </div>
        <div className="eyebrow">Project economics, made accessible</div>
        <h1 className="title">Welcome to Whittaker Geo</h1>
        <p className="subtitle">
          Create scenarios, compare outcomes, and keep your work in one private
          workspace.
        </p>
        {plan && (
          <p className="notice">
            Selected:{" "}
            {plan === "year"
              ? "Annual · CAD $499.99/year"
              : "Monthly · CAD $49.99/month"}
            . Sign in to continue. You will not be charged by signing in.
          </p>
        )}
        {(error || outerError) && (
          <div role="alert" className="notice">
            {error || outerError}
          </div>
        )}
        {status && (
          <div role="status" className="notice success">
            {status}
          </div>
        )}
        <button
          className="btn full"
          disabled={busy}
          onClick={() => signIn("google")}
        >
          Continue with Google
        </button>
        <div className="divider">or use an email link</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn("email");
          }}
        >
          <label className="form-label" htmlFor="email">
            Email address
          </label>
          <input
            className="text-input"
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn primary full" disabled={busy || !email}>
            Email me a sign-in link
          </button>
        </form>
      </section>
    </main>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}
function Input({
  field: f,
  value,
  setValue,
  disabled,
  compact = false,
  options,
  help,
  numericDraft,
  setNumericDraft,
  finishNumericDraft,
}: {
  field: Field;
  value: string | number | null | undefined;
  setValue: (v: string | number | null) => void;
  disabled: boolean;
  compact?: boolean;
  options?: string[];
  help?: string;
  numericDraft?: string;
  setNumericDraft?: (rawValue: string) => void;
  finishNumericDraft?: (rawValue: string) => void;
}) {
  return (
    <div className="field">
      {!compact && (
        <div className="model-field-heading">
          <label className="form-label" htmlFor={"f-" + f.id}>
            {f.label}<span className="unit">{f.unit}</span>
          </label>
          {f.help && <HelpDialog {...f.help} triggerLabel={`Help for ${f.label}`} />}
        </div>
      )}
      {f.type === "milestone" ? (
        <label className="model-year-choice">
          <input id={"f-" + f.id} type="radio" name={f.radioGroup || "facilities-completion"}
            aria-label={`${f.label}, year ${f.year}`} disabled={disabled}
            checked={value === "X"} onChange={() => setValue("X")} />
          <span className="sr-only">Year {f.year}</span>
        </label>
      ) : f.type === "select" && f.options?.length === 2 ? (
        <div className="model-radio-options" role="radiogroup" aria-label={f.label}>
          {(options ?? f.options).map((option) => <label key={option}>
            <input type="radio" name={f.id} value={option} checked={value === option} disabled={disabled}
              onChange={() => setValue(option)} />
            <span>{f.optionLabels?.[option] || optionLabel(option)}</span>
          </label>)}
        </div>
      ) : f.type === "select" ? (
        <select
          id={"f-" + f.id}
          aria-label={compact ? f.label + " year " + f.year : undefined}
          className="select"
          disabled={disabled}
          value={value ?? ""}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">Select…</option>
          {f.type === "select" && value && !(options ?? f.options ?? []).includes(String(value)) && <option value={value} disabled>{optionLabel(String(value))} — select a matching unit</option>}
          {(options ?? f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {f.optionLabels?.[o] || optionLabel(o)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={"f-" + f.id}
          aria-label={compact ? f.label + " year " + f.year : undefined}
          className="text-input"
          disabled={disabled}
          type="text"
          inputMode={f.type === "number" ? "decimal" : undefined}
          value={f.type === "number" ? numericDraft ?? value ?? "" : value ?? ""}
          onChange={(e) => {
            if (f.type === "number") setNumericDraft?.(e.target.value);
            else setValue(e.target.value === "" ? null : e.target.value);
          }}
          onBlur={f.type === "number" ? (e) => finishNumericDraft?.(e.target.value) : undefined}
        />
      )}
      {help && <p className="small">{help}</p>}
    </div>
  );
}
function Schedule({
  fields,
  inputs,
  setValue,
  numericDrafts,
  setNumericDraft,
  finishNumericDraft,
  disabled,
}: {
  fields: Field[];
  inputs: InputValues;
  setValue: (id: string, v: string | number | null) => void;
  numericDrafts: Record<string, string>;
  setNumericDraft: (id: string, rawValue: string) => void;
  finishNumericDraft: (id: string, rawValue: string) => void;
  disabled: boolean;
}) {
  const years = Array.from(new Set(fields.map((f) => f.year!))).sort(
      (a, b) => a - b,
    ),
    rows = Array.from(new Set(fields.map((f) => f.scheduleRow!)));
  return (
    <>
      <p className="subtitle" style={{ marginBottom: 16 }}>
        Project years match the calculation timeline. Select exactly one
        facilities completion year. Blank numeric schedule cells are treated as
        zero.
      </p>
      <div className="table-scroll schedule">
        <table className="table">
          <thead>
            <tr>
              <th>Activity</th>
              {years.map((y) => (
                <th key={y}>Year {y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const first = fields.find((f) => f.scheduleRow === r)!;
              return (
                <tr key={r}>
                  <th>
                    <div className="model-field-heading"><span>{first.label}</span>
                      {first.help && <HelpDialog {...first.help} triggerLabel={`Help for ${first.label}`} />}
                    </div>
                    <div className="small">{first.unit}</div>
                  </th>
                  {years.map((y) => {
                    const f = fields.find(
                      (f) => f.scheduleRow === r && f.year === y,
                    );
                    return (
                      <td key={y}>
                        {f && (
                          <Input
                            field={f}
                            value={inputs[f.id]}
                            setValue={(v) => setValue(f.id, v)}
                            numericDraft={numericDrafts[f.id]}
                            setNumericDraft={(raw) => setNumericDraft(f.id, raw)}
                            finishNumericDraft={(raw) => finishNumericDraft(f.id, raw)}
                            disabled={disabled}
                            compact
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Results({
  tab,
  setTab,
  run,
  manifest,
  busy,
  back,
  download,
}: {
  tab: "summary" | "detail" | "inputs";
  setTab: (tab: "summary" | "detail" | "inputs") => void;
  run: Run;
  manifest: Manifest | null;
  busy: boolean;
  back: () => void;
  download: () => void;
}) {
  const workbookResult = run.result && "outputSheets" in run.result ? run.result : null;
  const result = run.result && !("outputSheets" in run.result) ? run.result : null;
  return (
    <>
      <div className="row wrap">
        <button className="btn ghost" onClick={back}>
          <ArrowLeft size={16} />
          Inputs & run history
        </button>
        <button
          className="btn primary"
          disabled={busy || run.status !== "succeeded"}
          onClick={download}
        >
          <Download size={16} />
          Download editable XLSX
        </button>
      </div>
      <div className="eyebrow" style={{ marginTop: 30 }}>
        Saved run · {when(run.created_at)}
      </div>
      <h1 className="title">
        {run.status === "succeeded"
          ? "Your results"
          : run.status === "failed"
            ? "Calculation could not finish"
            : "Calculating your scenario"}
      </h1>
      <p className="subtitle">
        Input revision {run.calculation_revision} · Model{" "}
        {run.calculator_version}
      </p>
      {run.status === "failed" ? (
        <div className="notice">
          Your inputs are safe. Return to the calculation to review them and
          submit a new run. Reference: {run.error_code || "CALCULATION_FAILED"}
        </div>
      ) : workbookResult && manifest ? (
        <section className="card group-card">
          <WorkbookOutputs result={workbookResult} manifest={manifest} />
          <details className="model-submitted-inputs"><summary>Submitted inputs</summary>
            <table className="table"><tbody>{manifest.fields.map((field) => <tr key={field.id}>
              <th>{field.label}{field.year ? ` · Year ${field.year}` : ""}</th>
              <td>{run.inputs[field.id] ?? "—"} {field.unit}</td>
            </tr>)}</tbody></table>
          </details>
        </section>
      ) : !result ? (
        <div role="status" className="notice">
          {run.status === "queued"
            ? "Your calculation is queued."
            : "Calculating the baseline and sensitivity scenarios. This may take several minutes."}
        </div>
      ) : (
        <>
          <div className="actions" style={{ marginTop: 24 }}>
            {(["summary", "detail", "inputs"] as const).map((t) => (
              <button
                key={t}
                className={"btn " + (tab === t ? "primary" : "")}
                onClick={() => setTab(t)}
              >
                {t === "summary"
                  ? "Summary"
                  : t === "detail"
                    ? "Annual detail"
                    : "Submitted inputs"}
              </button>
            ))}
          </div>
          {tab === "summary" && (
            <>
              <div className="result-hero">
                <div className="eyebrow">Contractor NPV @ 10%</div>
                <div className="metric-value">
                  {usd(result.metrics.contractorNpv10)}
                </div>
                <p>Baseline · {result.annual.length} project years</p>
              </div>
              <div className="result-grid">
                <Metric
                  label="State NPV @ 10%"
                  value={usd(result.metrics.stateNpv10)}
                />
                <Metric
                  label="Capital investment"
                  value={usd(result.metrics.capitalInvestment)}
                />
                <Metric
                  label="Contractor IRR"
                  value={
                    result.metrics.irr === null
                      ? "Not defined"
                      : (result.metrics.irr * 100).toFixed(1) + "%"
                  }
                />
                <Metric
                  label="Payout"
                  value={
                    result.metrics.payoutYear === null
                      ? "Not reached"
                      : result.metrics.payoutYear === 0
                        ? "No investment deficit"
                        : "Year " + result.metrics.payoutYear
                  }
                />
              </div>
              <CashChart result={result} />
              <section className="card group-card" style={{ marginTop: 20 }}>
                <h3>Sensitivity to your baseline</h3>
                <p className="small">
                  Each multiplier is tested independently at 50% and 150% of
                  your submitted value. Amounts are contractor NPV at 10%, in
                  USD.
                </p>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Multiplier</th>
                        <th>50%</th>
                        <th>Baseline</th>
                        <th>150%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.sensitivity.map((s) => (
                        <tr key={s.input}>
                          <td>{s.label}</td>
                          <td>{usd(s.low)}</td>
                          <td>{usd(s.baseline)}</td>
                          <td>{usd(s.high)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {tab === "detail" && (
            <div className="card table-scroll" style={{ marginTop: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Contractor cash flow</th>
                    <th>Cumulative contractor</th>
                    <th>State cash flow</th>
                    <th>Cumulative state</th>
                    <th>Capital costs</th>
                    <th>Operating costs</th>
                  </tr>
                </thead>
                <tbody>
                  {result.annual.map((a) => (
                    <tr key={a.year}>
                      <td>{a.year}</td>
                      {[
                        a.contractor,
                        a.contractorCumulative,
                        a.state,
                        a.stateCumulative,
                        a.capex,
                        a.opex,
                      ].map((v, i) => (
                        <td key={i}>{usd(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "inputs" && (
            <div className="card table-scroll" style={{ marginTop: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Input</th>
                    <th>Submitted value</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(run.inputs || {}).map(([id, v]) => {
                    const f = manifest?.fields.find((f) => f.id === id);
                    return (
                      <tr key={id}>
                        <td>
                          {f?.label || id}
                          {f?.year ? " · Year " + f.year : ""}
                        </td>
                        <td>{v === null || v === "" ? "Blank" : String(v)}</td>
                        <td>{f?.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="small" style={{ marginTop: 20 }}>
            Exports contain editable result values. To recalculate, update the
            inputs and submit a new run.
          </p>
        </>
      )}
    </>
  );
}
function CashChart({ result }: { result: Result }) {
  const series = result.annual,
    all = series.flatMap((a) => [a.contractorCumulative, a.stateCumulative]);
  const min = Math.min(0, ...all),
    max = Math.max(1, ...all),
    y = (v: number) => 170 - ((v - min) / (max - min)) * 140;
  const path = (key: "contractorCumulative" | "stateCumulative") =>
    series
      .map(
        (a, i) =>
          (i ? "L" : "M") +
          (45 + (i * 620) / Math.max(1, series.length - 1)) +
          "," +
          y(a[key]),
      )
      .join(" ");
  return (
    <section className="card chart">
      <h3>
        Cumulative cash flow <span className="small">USD millions</span>
      </h3>
      <svg
        viewBox="0 0 720 205"
        role="img"
        aria-label="Cumulative contractor and state cash flow by project year"
      >
        {[min, (min + max) / 2, max].map((v, i) => (
          <g key={i}>
            <line x1="45" x2="665" y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x="0" y={y(v) + 4} fontSize="10" fill="var(--muted)">
              {(v / 1e6).toFixed(0)}
            </text>
          </g>
        ))}
        <path
          d={path("contractorCumulative")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
        />
        <path
          d={path("stateCumulative")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
        />
        <text x="45" y="195" fontSize="11">
          Year 1
        </text>
        <text x="620" y="195" fontSize="11">
          Year {series.length}
        </text>
      </svg>
      <div className="chart-key">
        <span>● Contractor</span>
        <span>● State</span>
      </div>
    </section>
  );
}
