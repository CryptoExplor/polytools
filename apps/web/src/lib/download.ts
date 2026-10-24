import { account } from "@poly/core";

/** Download only an explicitly confirmed, in-memory account export. */
export function downloadAccountExport(result: account.AccountExportResult): void {
  const blob = new Blob([result.contents], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Let the browser start the download before releasing the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
