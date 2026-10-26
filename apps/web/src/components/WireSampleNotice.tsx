/** Session-persistent development provenance; never a live-data indicator. */
export function WireSampleNotice() {
  return (
    <div
      className="notice warn sample-mode-notice"
      role="note"
      aria-label="Wire-sample data provenance"
      style={{ marginBottom: 14 }}
    >
      <div>
        <strong>Development wire samples used in this session.</strong> Some public responses are captured or derived fixtures, not live data or production-compatibility evidence. This notice remains visible across tools; private account reads never use these samples.
      </div>
    </div>
  );
}
