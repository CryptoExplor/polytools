/**
 * Verified Connect RPC surface, rendered for the SDK guide.
 *
 * Every row comes from `lib/apiSurface.ts`, which the test suite checks against
 * the installed SDK's generated protos. The point of this table is that it can
 * be trusted: it distinguishes "declared by the SDK" from "seen working", and it
 * says `unspecified` rather than inventing an auth requirement.
 *
 * Read and write rows are separated on purpose — PolyTools itself is read-only,
 * and the page should make that obvious rather than bury it.
 */

import { useMemo, useState } from "react";
import {
  API_SURFACE,
  ENCODING_NOTES,
  matchesSurfaceQuery,
  surfaceByService,
  surfaceCounts,
  type SurfaceEntry,
} from "../lib/apiSurface";
import { Card, Pill } from "../components/ui";

const AUTH_LABEL: Record<SurfaceEntry["auth"], string> = {
  public: "public",
  session: "session token",
  "interactive-session": "interactive session",
  unspecified: "not documented",
};

function ModePill({ mode }: { mode: SurfaceEntry["mode"] }) {
  return <Pill kind={mode === "read" ? "up" : "down"}>{mode}</Pill>;
}

function Row({ entry }: { entry: SurfaceEntry }) {
  return (
    <tr>
      <td>
        <span className="mono">{entry.method}</span>
      </td>
      <td className="muted">{entry.summary}</td>
      <td>
        <ModePill mode={entry.mode} />
      </td>
      <td className="muted">{AUTH_LABEL[entry.auth]}</td>
      <td className="mono muted">{entry.responseKeys.join(", ") || "—"}</td>
    </tr>
  );
}

export function ApiSurfaceTable() {
  const [query, setQuery] = useState("");
  const counts = surfaceCounts();
  const groups = useMemo(() => surfaceByService(), []);

  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    return groups
      .map((group) => ({
        service: group.service,
        entries: group.entries.filter((entry) => matchesSurfaceQuery(entry, query)),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, query]);

  const shown = filtered.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <div className="api-surface">
    <Card
      title="Verified API surface"
      subtitle={`${counts.total} Connect RPC methods · ${counts.reads} read · ${counts.writes} write. Each row is declared by the installed SDK and was observed working in an independent client. PolyTools sends none of the write methods — the test suite asserts that.`}
    >
      <label className="field">
        <span>Filter by method, description or field</span>
        <input
          className="input mono"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. GetOrderBook, symbolId, balances"
          aria-label="Filter API surface"
        />
      </label>
      <p className="faint">
        Showing {shown} of {counts.total}.
      </p>

      {filtered.map((group) => (
        <div key={group.service}>
          <h3 className="mono">{group.service}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Returns / does</th>
                  <th>Mode</th>
                  <th>Auth</th>
                  <th>Key response fields</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry) => (
                  <Row key={entry.rpc} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {shown === 0 && <p className="faint">No method matches “{query}”.</p>}

      <h3>Field encodings that are easy to get wrong</h3>
      <ul className="faint">
        {Object.entries(ENCODING_NOTES).map(([key, text]) => (
          <li key={key}>
            <span className="mono">{key}</span> — {text}
          </li>
        ))}
      </ul>

      <p className="faint">
        “Not documented” means the official SDK reference does not state the requirement. It is not a
        guess in either direction. Responses and request shapes not listed here were not observed.
      </p>
    </Card>
    </div>
  );
}

export default ApiSurfaceTable;
