import type { EditorAssetRecord } from "./assetManifest";

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

type DevAssetsState = {
  records: EditorAssetRecord[];
  validation: ValidationReport | null;
  status: string;
  busy: boolean;
};

export async function startDevAssets(app: HTMLDivElement): Promise<void> {
  app.className = "dev-assets";
  const state: DevAssetsState = {
    records: [],
    validation: null,
    status: "Loading staged assets...",
    busy: false,
  };

  const refresh = async (): Promise<void> => {
    state.records = await loadAssetRecords();
    state.validation = await validateAssets();
    render();
  };

  const promoteAll = async (): Promise<void> => {
    state.busy = true;
    state.status = "Exporting valid staged assets...";
    render();
    try {
      const report = await promoteStagedAssets();
      state.status = report.promoted.length
        ? `Exported ${report.promoted.length} staged asset${report.promoted.length === 1 ? "" : "s"}.`
        : "No staged assets were exported.";
      if (report.issues.length) {
        state.status += ` ${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} need attention.`;
      }
      await refresh();
    } catch (error) {
      state.status = error instanceof Error ? error.message : "Bulk export failed.";
      render();
    } finally {
      state.busy = false;
      render();
    }
  };

  const promoteOne = async (record: EditorAssetRecord): Promise<void> => {
    state.busy = true;
    state.status = `Exporting ${record.label}...`;
    render();
    try {
      const report = await promoteStagedAssets(record);
      state.status = report.promoted.length
        ? `Exported ${record.label} into the game asset folder.`
        : `${record.label} was not exported.`;
      if (report.issues.length) {
        state.status += ` ${report.issues.map((issue) => issue.message).join("; ")}`;
      }
      await refresh();
    } catch (error) {
      state.status = error instanceof Error ? error.message : `Failed to export ${record.label}.`;
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
      void promoteAll();
    });
    app.querySelectorAll<HTMLButtonElement>("[data-open-editor]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = recordByKey(state.records, button.dataset.openEditor);
        if (!record) return;
        window.location.href = editorUrl(record);
      });
    });
    app.querySelectorAll<HTMLButtonElement>("[data-export-asset]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = recordByKey(state.records, button.dataset.exportAsset);
        if (!record) return;
        void promoteOne(record);
      });
    });
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
  if (!response.ok) throw new Error("Asset export failed.");
  return (await response.json()) as PromoteReport;
}

function createDevAssetsMarkup(state: DevAssetsState): string {
  const staged = state.records
    .filter((record) => record.staged)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const issueMap = issuesByAsset(state.validation?.issues ?? []);
  const validCount = staged.filter((record) => isValidStagedRecord(record, issueMap)).length;
  const copiedCount = staged.filter((record) => record.liveModelExists && record.liveSidecarExists).length;
  const changedCount = staged.filter((record) => hasStagedChanges(record)).length;
  const rows = staged.length
    ? staged.map((record) => createStagedAssetRow(record, issueMap.get(assetIssueId(record)) ?? [], state.busy)).join("")
    : `<tr><td colspan="6" class="dev-assets-empty-cell">No staged model assets found.</td></tr>`;

  return `
    <main class="dev-assets-shell">
      <header class="dev-assets-header">
        <div>
          <p>Daemon Syndicate</p>
          <h1>Staged Assets</h1>
        </div>
        <div class="dev-assets-actions">
          <button id="refreshAssetsButton" type="button" ${state.busy ? "disabled" : ""}>Refresh</button>
          <button id="bulkExportAssetsButton" type="button" ${state.busy || validCount === 0 ? "disabled" : ""}>Export Valid Staged</button>
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
        : "Ready to export";
  const statusClass = hasErrors ? "error" : hasChanges || !liveCopied ? "pending" : "ok";

  return `
    <tr>
      <td><strong>${escapeHtml(record.label)}</strong><span>${escapeHtml(record.name)}</span></td>
      <td>${escapeHtml(record.category)}</td>
      <td>${comparisonPill(record.modelComparison, "Model")}</td>
      <td>${record.sidecarExists ? comparisonPill(record.sidecarComparison, "Gameplay") : statusPill(false, "Missing")}</td>
      <td><span class="dev-assets-status-pill ${statusClass}">${escapeHtml(status)}</span></td>
      <td class="dev-assets-row-actions">
        <button type="button" data-open-editor="${escapeHtml(assetKey(record))}" ${busy ? "disabled" : ""} aria-label="Open ${escapeHtml(record.label)} in asset editor" title="Open in editor">
          <span aria-hidden="true">✎</span>
        </button>
        <button type="button" data-export-asset="${escapeHtml(assetKey(record))}" ${busy || hasErrors ? "disabled" : ""} aria-label="Copy ${escapeHtml(record.label)} GLB and JSON into game assets" title="Copy GLB and JSON into game">
          <span aria-hidden="true">⇥</span>
        </button>
      </td>
    </tr>
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

function isValidStagedRecord(record: EditorAssetRecord, issueMap: Map<string, ValidationIssue[]>): boolean {
  return record.sidecarExists && !(issueMap.get(assetIssueId(record)) ?? []).some((issue) => issue.severity === "error");
}

function recordByKey(records: EditorAssetRecord[], key: string | undefined): EditorAssetRecord | undefined {
  return records.find((record) => record.staged && assetKey(record) === key);
}

function assetKey(record: EditorAssetRecord): string {
  return `_staged/${record.category}/${record.name}`;
}

function editorUrl(record: EditorAssetRecord): string {
  return `/dev/asset-editor?asset=${encodeURIComponent(`${record.category}/${record.name}`)}&staged=1`;
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
