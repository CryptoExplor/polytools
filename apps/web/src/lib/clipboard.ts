export type CopyStatus = "idle" | "copied" | "failed";
export type ClipboardWriter = (text: string) => Promise<void>;

/** Return a safe outcome instead of hiding clipboard failures. */
export async function copyTextToClipboard(
  text: string,
  writeText: ClipboardWriter,
): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function copyButtonPresentation(
  status: CopyStatus,
  label: string,
  copiedLabel: string,
): { visibleLabel: string; accessibleLabel: string; title?: string } {
  if (status === "copied") {
    return {
      visibleLabel: copiedLabel,
      accessibleLabel: copiedLabel,
      title: "Copied to clipboard",
    };
  }
  if (status === "failed") {
    return {
      visibleLabel: "Copy failed",
      accessibleLabel: "Copy failed. Try again or copy the text manually.",
      title: "Clipboard access failed. Try again or copy the text manually.",
    };
  }
  return {
    visibleLabel: label,
    accessibleLabel: /^copy\b/i.test(label.trim()) ? label : `Copy ${label}`,
  };
}
