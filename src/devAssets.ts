import type { EditorAssetRecord } from "./assetManifest";
import "./devStyle.css";

type ValidationIssue = {
  severity: "error" | "warning";
  asset: string;
  message: string;
};

type ValidationReport = {
  ok: boolean;
  assetCount: number;
  issues: ValidationIssue[];
};

type PromoteReport = {
  ok: boolean;
  promoted: Array<{ category: string; name: string }>;
  issues: ValidationIssue[];
};

type DevAssetsModal =
  | { type: "sidecar"; recordKey: string; text: string; status: string; saving: boolean }
  | { type: "promote"; recordKey?: string; issues: ValidationIssue[]; promoting: boolean };

type DevAssetsState = {
  records: EditorAssetRecord[];
  validation: ValidationReport | null;
  status: string;
  busy: boolean;
  modal: DevAssetsModal | null;
};

export async function startDevAssets(app: HTMLDivElement): Promise<void> {
  app.className = "dev-assets";
  const state: DevAssetsState = {
    records: [],
    validation: null,
    status: "Loading staged assets...",
    busy: false,
    modal: null,
  };

  const refresh = async (): Promise<void> => {
    state.records = await loadAssetRecords();
    state.validation = await validateAssets();
    render();
  };

  const promoteAll = async (): Promise<void> => {
    state.busy = true;
    state.status = "Promoting valid staged assets...";
    render();
    try {
      const report = await promoteStagedAssets();
      state.status = report.promoted.length
        ? `Promoted ${report.promoted.length} staged asset${report.promoted.length === 1 ? "" : "s"}.`
        : "No staged assets were promoted.";
      if (report.issues.length) {
        state.status += ` ${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} need attention.`;
      }
      state.modal = null;
      await refresh();
    } catch (error) {
      state.status = error instanceof Error ? error.message : "Bulk promotion failed.";
      render();
    } finally {
      state.busy = false;
      render();
    }
  };

  const promoteOne = async (record: EditorAssetRecord): Promise<void> => {
    state.busy = true;
    state.status = `Promoting ${record.label}...`;
    render();
    try {
      const report = await promoteStagedAssets(record);
      state.status = report.promoted.length
        ? `Promoted ${record.label} into the game asset folder.`
        : `${record.label} was not promoted.`;
      if (report.issues.length) {
        state.status += ` ${report.issues.map((issue) => issue.message).join("; ")}`;
      }
      state.modal = null;
      await refresh();
    } catch (error) {
      state.status = error instanceof Error ? error.message : `Failed to promote ${record.label}.`;
      render();
    } finally {
      state.busy = false;
      render();
    }
  };

  const render = (): void => {
    app.innerHTML = createDevAssetsMarkup(state);
    app.querySelector<HTMLButtonElement>("#refreshAssetsButton")?.addEventListener("click", () => {
      state.status = "Refreshing staged assets...";
      render();
      void refresh().catch((error: unknown) => {
        state.status = error instanceof Error ? error.message : "Refresh failed.";
        render();
      });
    });
    app.querySelector<HTMLButtonElement>("#bulkExportAssetsButton")?.addEventListener("click", () => {
      state.modal = createPromoteModal(state);
      render();
    });
    app.querySelectorAll<HTMLButtonElement>("[data-open-preview]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = recordByKey(state.records, button.dataset.openPreview);
        if (!record) return;
        window.location.href = previewUrl(record);
      });
    });
    app.querySelectorAll<HTMLButtonElement>("[data-edit-sidecar]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = recordByKey(state.records, button.dataset.editSidecar);
        if (!record) return;
        state.modal = {
          type: "sidecar",
          recordKey: assetKey(record),
          text: JSON.stringify(record.sidecar, null, 2),
          status: record.sidecarExists ? "Loaded sidecar." : "Loaded category defaults.",
          saving: false,
        };
        render();
      });
    });
    app.querySelectorAll<HTMLButtonElement>("[data-promote-asset]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = recordByKey(state.records, button.dataset.promoteAsset);
        if (!record) return;
        state.modal = createPromoteModal(state, record);
        render();
      });
    });
    app.querySelector<HTMLButtonElement>("[data-close-modal]")?.addEventListener("click", () => {
      state.modal = null;
      render();
    });
    app.querySelector<HTMLButtonElement>("[data-save-sidecar]")?.addEventListener("click", () => {
      void saveSidecarFromModal();
    });
    app.querySelector<HTMLTextAreaElement>("#sidecarEditorText")?.addEventListener("input", (event) => {
      if (state.modal?.type !== "sidecar") return;
      state.modal.text = (event.currentTarget as HTMLTextAreaElement).value;
      state.modal.status = "Unsaved changes.";
    });
    app.querySelector<HTMLButtonElement>("[data-confirm-promote]")?.addEventListener("click", () => {
      if (state.modal?.type !== "promote" || state.modal.issues.some((issue) => issue.severity === "error")) return;
      const record = state.modal.recordKey ? recordByKey(state.records, state.modal.recordKey) : undefined;
      if (record) void promoteOne(record);
      else void promoteAll();
    });
  };

  const saveSidecarFromModal = async (): Promise<void> => {
    if (state.modal?.type !== "sidecar") return;
    const modal = state.modal;
    const record = recordByKey(state.records, modal.recordKey);
    if (!record) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(modal.text);
    } catch (error) {
      modal.status = error instanceof Error ? error.message : "Invalid JSON.";
      render();
      return;
    }

    modal.saving = true;
    modal.status = "Saving...";
    render();
    try {
      const response = await fetch(`/__dev/assets/${modal.recordKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = (await response.json()) as EditorAssetRecord["sidecar"];
      record.sidecar = saved;
      record.sidecarExists = true;
      modal.text = JSON.stringify(saved, null, 2);
      modal.status = "Saved.";
      await refresh();
      state.modal = {
        type: "sidecar",
        recordKey: assetKey(record),
        text: JSON.stringify(record.sidecar, null, 2),
        status: "Saved.",
        saving: false,
      };
    } catch (error) {
      modal.status = error instanceof Error ? error.message : "Save failed.";
    } finally {
      if (state.modal?.type === "sidecar") state.modal.saving = false;
      render();
    }
  };

  render();
  try {
    await refresh();
    state.status = "Staged assets loaded.";
    render();
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Failed to load staged assets.";
    render();
  }
}

async function loadAssetRecords(): Promise<EditorAssetRecord[]> {
  const response = await fetch("/__dev/assets");
  if (!response.ok) throw new Error("Asset discovery endpoint missing. Restart the Vite dev server.");
  const payload = (await response.json()) as { assets?: EditorAssetRecord[] };
  return payload.assets ?? [];
}

async function validateAssets(): Promise<ValidationReport> {
  const response = await fetch("/__dev/assets/bulk-validate", { method: "POST" });
  if (!response.ok) throw new Error("Asset validation failed.");
  return (await response.json()) as ValidationReport;
}

async function promoteStagedAssets(record?: EditorAssetRecord): Promise<PromoteReport> {
  const response = await fetch("/__dev/assets/promote-staged", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record ? { category: record.category, name: record.name } : { all: true }),
  });
  if (!response.ok) throw new Error("Asset promotion failed.");
  return (await response.json()) as PromoteReport;
}

function createDevAssetsMarkup(state: DevAssetsState): string {
  const staged = state.records
    .filter((record) => record.staged)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const issueMap = issuesByAsset(state.validation?.issues ?? []);
  const validCount = staged.filter((record) => promoteErrorsForRecord(record, issueMap).length === 0).length;
  const copiedCount = staged.filter((record) => record.liveModelExists && record.liveSidecarExists).length;
  const changedCount = staged.filter((record) => hasStagedChanges(record)).length;
  const rows = staged.length
    ? staged.map((record) => createStagedAssetRow(record, issueMap.get(assetIssueId(record)) ?? [], state.busy)).join("")
    : `<tr><td colspan="6" class="dev-assets-empty-cell">No staged model assets found.</td></tr>`;
  const modalMarkup = state.modal ? createModalMarkup(state) : "";

  return `
    <main class="dev-assets-shell">
      <header class="dev-assets-header">
        <div>
          <p>Daemon Syndicate</p>
          <h1>Staged Assets</h1>
        </div>
        <div class="dev-assets-actions">
          <a href="/">Back to Main Menu</a>
          <button id="refreshAssetsButton" type="button" ${state.busy ? "disabled" : ""}>Refresh</button>
          <button id="bulkExportAssetsButton" type="button" ${state.busy || staged.length === 0 ? "disabled" : ""}>Promote Staged</button>
        </div>
      </header>
      <section class="dev-assets-summary" aria-label="Asset status summary">
        <div><span>Staged Models</span><strong>${staged.length}</strong></div>
        <div><span>Valid</span><strong>${validCount}</strong></div>
        <div><span>Changed</span><strong>${changedCount}</strong></div>
        <div><span>Copied Live</span><strong>${copiedCount}</strong></div>
        <div><span>Issues</span><strong>${state.validation?.issues.length ?? 0}</strong></div>
      </section>
      <section class="dev-assets-table-wrap" aria-label="Staged model assets">
        <table class="dev-assets-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Category</th>
              <th>Staged GLB</th>
              <th>Staged Sidecar</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <footer class="dev-assets-status">${escapeHtml(state.status)}</footer>
    </main>
    ${modalMarkup}
  `;
}

function createStagedAssetRow(record: EditorAssetRecord, issues: ValidationIssue[], busy: boolean): string {
  const liveCopied = Boolean(record.liveModelExists && record.liveSidecarExists);
  const hasErrors = issues.some((issue) => issue.severity === "error");
  const hasChanges = hasStagedChanges(record);
  const status = hasErrors
    ? issues.map((issue) => issue.message).join("; ")
    : hasChanges
      ? changedSummary(record)
      : liveCopied
        ? "Current in game"
        : "Ready to promote";
  const statusClass = hasErrors ? "error" : hasChanges || !liveCopied ? "pending" : "ok";

  return `
    <tr>
      <td><strong>${escapeHtml(record.label)}</strong><span>${escapeHtml(record.name)}</span></td>
      <td>${escapeHtml(record.category)}</td>
      <td>${comparisonPill(record.modelComparison, "Model")}</td>
      <td>${record.sidecarExists ? comparisonPill(record.sidecarComparison, "Gameplay") : statusPill(false, "Missing")}</td>
      <td><span class="dev-assets-status-pill ${statusClass}">${escapeHtml(status)}</span></td>
      <td class="dev-assets-row-actions">
        <button type="button" data-open-preview="${escapeHtml(assetKey(record))}" ${busy ? "disabled" : ""} aria-label="Preview ${escapeHtml(record.label)}" title="Preview model">
          ${iconMarkup("preview")}
        </button>
        <button type="button" data-edit-sidecar="${escapeHtml(assetKey(record))}" ${busy ? "disabled" : ""} aria-label="Edit ${escapeHtml(record.label)} sidecar" title="Edit sidecar JSON">
          ${iconMarkup("sidecar")}
        </button>
        <button type="button" data-promote-asset="${escapeHtml(assetKey(record))}" ${busy ? "disabled" : ""} aria-label="Promote ${escapeHtml(record.label)} into runtime assets" title="Promote into runtime assets">
          ${iconMarkup("promote")}
        </button>
      </td>
    </tr>
  `;
}

function createModalMarkup(state: DevAssetsState): string {
  if (!state.modal) return "";
  const body = state.modal.type === "sidecar" ? createSidecarModalMarkup(state) : createPromoteModalMarkup(state);
  return `
    <div class="dev-assets-modal-backdrop" role="presentation">
      <section class="dev-assets-modal" role="dialog" aria-modal="true" aria-labelledby="devAssetsModalTitle">
        ${body}
      </section>
    </div>
  `;
}

function createSidecarModalMarkup(state: DevAssetsState): string {
  const modal = state.modal?.type === "sidecar" ? state.modal : null;
  const record = modal ? recordByKey(state.records, modal.recordKey) : undefined;
  if (!modal || !record) return "";
  return `
    <header class="dev-assets-modal-header">
      <div>
        <p>Sidecar JSON</p>
        <h2 id="devAssetsModalTitle">${escapeHtml(record.label)}</h2>
      </div>
      <button type="button" data-close-modal aria-label="Close sidecar editor">${iconMarkup("close")}</button>
    </header>
    <textarea id="sidecarEditorText" class="dev-assets-sidecar-editor" spellcheck="false">${escapeHtml(modal.text)}</textarea>
    <footer class="dev-assets-modal-actions">
      <span>${escapeHtml(modal.status)}</span>
      <button type="button" data-save-sidecar ${modal.saving ? "disabled" : ""}>Save Sidecar</button>
    </footer>
  `;
}

function createPromoteModalMarkup(state: DevAssetsState): string {
  const modal = state.modal?.type === "promote" ? state.modal : null;
  if (!modal) return "";
  const record = modal.recordKey ? recordByKey(state.records, modal.recordKey) : undefined;
  const title = record ? `Promote ${record.label}` : "Promote Staged Assets";
  const hasIssues = modal.issues.length > 0;
  const hasBlockingIssues = modal.issues.some((issue) => issue.severity === "error");
  const issuesMarkup = hasIssues
    ? `<ul class="dev-assets-issue-list">${modal.issues.map((issue) => `<li class="${issue.severity}"><strong>${escapeHtml(issue.asset)}</strong><span>${escapeHtml(issue.message)}</span></li>`).join("")}</ul>`
    : `<p class="dev-assets-modal-copy">${record ? "This will copy the staged GLB and sidecar into the runtime asset folder." : "This will copy all valid staged GLBs and sidecars into the runtime asset folders."}</p>`;

  return `
    <header class="dev-assets-modal-header">
      <div>
        <p>${hasBlockingIssues ? "Validation Required" : hasIssues ? "Review Warnings" : "Ready"}</p>
        <h2 id="devAssetsModalTitle">${escapeHtml(title)}</h2>
      </div>
      <button type="button" data-close-modal aria-label="Close promote dialog">${iconMarkup("close")}</button>
    </header>
    ${issuesMarkup}
    <footer class="dev-assets-modal-actions">
      <span>${hasBlockingIssues ? "Resolve validation errors before promoting." : hasIssues ? "Warnings will not block promotion." : "Validation passed."}</span>
      <button type="button" data-confirm-promote ${hasBlockingIssues || modal.promoting ? "disabled" : ""}>Promote</button>
    </footer>
  `;
}

function statusPill(ok: boolean, label: string): string {
  return `<span class="dev-assets-status-pill ${ok ? "ok" : "error"}">${escapeHtml(label)}</span>`;
}

function comparisonPill(comparison: EditorAssetRecord["modelComparison"], label: string): string {
  if (!comparison) return statusPill(true, "Present");
  const className = comparison.status === "current" ? "ok" : comparison.status === "missing" ? "error" : "pending";
  const text =
    comparison.status === "current"
      ? "Current"
      : comparison.status === "missing"
        ? "New"
        : comparison.status === "newer"
          ? `${label} newer`
          : comparison.status === "older"
            ? `${label} differs`
            : `${label} changed`;
  const title = comparison.liveUpdatedAt
    ? `Staged: ${formatDateTime(comparison.stagedUpdatedAt)} | Live: ${formatDateTime(comparison.liveUpdatedAt)}`
    : `Staged: ${formatDateTime(comparison.stagedUpdatedAt)}`;
  return `<span class="dev-assets-status-pill ${className}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

function hasStagedChanges(record: EditorAssetRecord): boolean {
  return isChangedComparison(record.modelComparison) || isChangedComparison(record.sidecarComparison);
}

function isChangedComparison(comparison: EditorAssetRecord["modelComparison"]): boolean {
  return Boolean(comparison && comparison.status !== "current");
}

function changedSummary(record: EditorAssetRecord): string {
  const changes = [];
  if (isChangedComparison(record.modelComparison)) changes.push("model");
  if (isChangedComparison(record.sidecarComparison)) changes.push("gameplay");
  return `${changes.join(" and ")} staged`;
}

function recordByKey(records: EditorAssetRecord[], key: string | undefined): EditorAssetRecord | undefined {
  return records.find((record) => record.staged && assetKey(record) === key);
}

function assetKey(record: EditorAssetRecord): string {
  return `_staged/${record.category}/${record.name}`;
}

function previewUrl(record: EditorAssetRecord): string {
  return `/dev/asset-preview?asset=${encodeURIComponent(`${record.category}/${record.name}`)}&staged=1`;
}

function createPromoteModal(state: DevAssetsState, record?: EditorAssetRecord): DevAssetsModal {
  const issueMap = issuesByAsset(state.validation?.issues ?? []);
  const records = record ? [record] : state.records.filter((candidate) => candidate.staged);
  return {
    type: "promote",
    recordKey: record ? assetKey(record) : undefined,
    issues: records.flatMap((candidate) => promoteIssuesForRecord(candidate, issueMap)),
    promoting: false,
  };
}

function promoteIssuesForRecord(record: EditorAssetRecord, issueMap: Map<string, ValidationIssue[]>): ValidationIssue[] {
  return issueMap.get(assetIssueId(record)) ?? [];
}

function promoteErrorsForRecord(record: EditorAssetRecord, issueMap: Map<string, ValidationIssue[]>): ValidationIssue[] {
  return promoteIssuesForRecord(record, issueMap).filter((issue) => issue.severity === "error");
}

function issuesByAsset(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const existing = map.get(issue.asset) ?? [];
    existing.push(issue);
    map.set(issue.asset, existing);
  }
  return map;
}

function assetIssueId(record: EditorAssetRecord): string {
  return record.staged ? `_staged/${record.category}/${record.name}` : `${record.category}/${record.name}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function iconMarkup(icon: "preview" | "sidecar" | "promote" | "close"): string {
  if (icon === "preview") {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>`;
  }
  if (icon === "sidecar") {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6V3Z"/><path d="M14 3v4h4"/><path d="M9 11h6M9 15h6"/></svg>`;
  }
  if (icon === "promote") {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M5 17v3h14v-3"/></svg>`;
  }
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
