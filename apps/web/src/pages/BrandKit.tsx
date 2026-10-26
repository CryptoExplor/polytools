import { useMemo, useState } from "react";
import {
  BRAND_ANNOUNCEMENT_URL,
  BRAND_COLORS,
  BRAND_IMAGERY_ASSETS,
  BRAND_KIT_LIVE_URL,
  BRAND_KIT_ZIP_URL,
  BRAND_LOGO_ASSETS,
  POLYBOT_AVATARS,
  POLYESTER_FULL_LOGO_DARK_SVG,
  POLYESTER_FULL_LOGO_LIGHT_SVG,
  POLYESTER_LOGOMARK_SVG,
  SCAN_BRAND_KIT_ZIP_URL,
  TOKEN_BRAND_SPECS,
  getTokenPackshotUrl,
  type TokenViewAngle,
} from "../brand";
import { Card, CopyButton, EmptyState, MetricCell, MetricStrip, PageHeader, Pill, SymBadge } from "../components/ui";
import { IconSearch } from "../components/icons";

type BrandSectionTab = "all" | "logos" | "tokens" | "colors" | "imagery" | "avatars" | "partners";

function LogoPreviewImage({
  url,
  title,
  fallbackSvg,
}: {
  url: string;
  title: string;
  fallbackSvg: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="brand-inline-svg"
        dangerouslySetInnerHTML={{ __html: fallbackSvg }}
        aria-label={title}
      />
    );
  }
  return (
    <img
      src={url}
      alt={title}
      className="brand-logo-img"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function BrandFilterEmptyState({
  kind,
  query,
  onClear,
}: {
  kind: "token" | "avatar";
  query: string;
  onClear: () => void;
}) {
  const subject = kind === "token" ? "token packshots" : "Polybot avatars";
  return (
    <EmptyState
      title={`No ${subject} match`}
      description={`No results for “${query.trim()}”. Try another symbol or name, or clear the filter.`}
      action={<button type="button" className="btn sm" onClick={onClear}>Clear Filter</button>}
    />
  );
}

export function BrandKitPage() {
  const [activeTab, setActiveTab] = useState<BrandSectionTab>("all");
  const [tokenAngle, setTokenAngle] = useState<TokenViewAngle>("front");
  const [tokenQuery, setTokenQuery] = useState("");
  const [avatarQuery, setAvatarQuery] = useState("");

  const filteredTokens = useMemo(() => {
    const q = tokenQuery.trim().toLowerCase();
    if (!q) return TOKEN_BRAND_SPECS;
    return TOKEN_BRAND_SPECS.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
    );
  }, [tokenQuery]);

  const filteredAvatars = useMemo(() => {
    const q = avatarQuery.trim().toLowerCase();
    if (!q) return POLYBOT_AVATARS;
    return POLYBOT_AVATARS.filter(
      (a) => a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q),
    );
  }, [avatarQuery]);

  const coreLogos = useMemo(
    () => BRAND_LOGO_ASSETS.filter((l) => l.category !== "partner"),
    [],
  );
  const partnerLogos = useMemo(
    () => BRAND_LOGO_ASSETS.filter((l) => l.category === "partner"),
    [],
  );

  const showLogos = activeTab === "all" || activeTab === "logos";
  const showColors = activeTab === "all" || activeTab === "colors";
  const showTokens = activeTab === "all" || activeTab === "tokens";
  const showImagery = activeTab === "all" || activeTab === "imagery";
  const showAvatars = activeTab === "all" || activeTab === "avatars";
  const showPartners = activeTab === "all" || activeTab === "partners";

  return (
    <div className="page-stack">
      <PageHeader
        title="Polyester Brand Kit & Token Assets"
        badge={<Pill kind="accent">#FA2F6F · Brand Guidelines</Pill>}
        subtitle="Official logos, favicons, color specifications, 15 market token packshots (front, side, low-angle), 3D imagery loops, Polybot avatars, and Scan / Zipper partner lockups."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <CopyButton text={POLYESTER_LOGOMARK_SVG} label="Copy Symbol SVG" />
            <CopyButton text={POLYESTER_FULL_LOGO_DARK_SVG} label="Copy Full Logo SVG" />
            <a
              href={BRAND_KIT_ZIP_URL}
              target="_blank"
              rel="noreferrer"
              className="btn primary sm"
            >
              Download Brand Assets (.zip)
            </a>
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label="Primary Brand Accent"
          value="#FA2F6F"
          sub="Polyester Pink · oklch(0.647 0.235 9.4)"
        />
        <MetricCell
          label="Logo & Partner Lockups"
          value={`${BRAND_LOGO_ASSETS.length} SVGs`}
          sub="Symbol, Wordmark, Full, Scan & Zipper"
        />
        <MetricCell
          label="Token Packshots"
          value={`${TOKEN_BRAND_SPECS.length} Tokens × 3`}
          sub="Front, Side & Low-angle WebP views"
        />
        <MetricCell
          label="Imagery & Polybots"
          value={`${BRAND_IMAGERY_ASSETS.length + POLYBOT_AVATARS.length} Assets`}
          sub={`${BRAND_IMAGERY_ASSETS.length} stills/loops · ${POLYBOT_AVATARS.length} Polybot avatars`}
        />
      </MetricStrip>

      {/* Section Filter Bar */}
      <div className="row-flex between" style={{ gap: 12 }}>
        <div className="seg-group" role="group" aria-label="Brand kit sections">
          {(
            [
              ["all", "All Sections"],
              ["logos", "Logos & Favicons"],
              ["tokens", `Tokens (${TOKEN_BRAND_SPECS.length})`],
              ["colors", "Colors & Type"],
              ["imagery", "Imagery & Loops"],
              ["avatars", "Polybot Avatars"],
              ["partners", "Scan & Zipper"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeTab === id}
              className={`seg-btn ${activeTab === id ? "active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="row-flex" style={{ gap: 8 }}>
          <a
            href={BRAND_ANNOUNCEMENT_URL}
            target="_blank"
            rel="noreferrer"
            className="btn sm ghost"
          >
            Announcement ↗
          </a>
          <a
            href={BRAND_KIT_LIVE_URL}
            target="_blank"
            rel="noreferrer"
            className="btn sm ghost"
          >
            Official Brand Kit ↗
          </a>
        </div>
      </div>

      {/* 1. App Icons, Favicons & Official Logo Lockups */}
      {showLogos && (
        <Card
          title="App Favicon, Symbol & Logo Lockups"
          subtitle="Use the symbol for app icons and favicons, the wordmark on its own, or the full lockup when the symbol sits with the Polyester name. Right-click the top-left sidebar logo at any time for quick copy/download."
          actions={
            <div className="row-flex" style={{ gap: 6 }}>
              <a
                href="/favicon.svg"
                download="polytools-favicon.svg"
                className="btn sm ghost"
              >
                Download Favicon SVG
              </a>
              <a
                href="/logo-dark.svg"
                download="polyester-logo-dark.svg"
                className="btn sm ghost"
              >
                Download Dark SVG
              </a>
              <a
                href="/logo-light.svg"
                download="polyester-logo-light.svg"
                className="btn sm ghost"
              >
                Download Light SVG
              </a>
            </div>
          }
        >
          {/* App Favicon Multi-Size Scale */}
          <div className="brand-favicon-bar">
            <div className="brand-favicon-meta">
              <strong>App Icon & Favicon Scale</strong>
              <span className="muted">
                Active in <code className="mono">index.html</code>,{" "}
                <code className="mono">site.webmanifest</code>, and sidebar header (
                <code className="mono">#FA2F6F</code> Polyester Pink).
              </span>
            </div>
            <div className="brand-favicon-sizes">
              {[16, 24, 32, 48, 64].map((sz) => (
                <div key={sz} className="brand-favicon-item">
                  <img
                    src="/favicon.svg"
                    alt={`${sz}px favicon`}
                    width={sz}
                    height={sz}
                    style={{ borderRadius: Math.round(sz * 0.25) }}
                  />
                  <span className="mono faint">{sz}×{sz}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="brand-logo-grid">
            {coreLogos.map((asset) => (
              <div key={asset.id} className="brand-asset-card">
                <div
                  className={`brand-asset-stage ${
                    asset.surface === "light" ? "stage-light" : "stage-dark"
                  }`}
                >
                  <LogoPreviewImage
                    url={asset.url}
                    title={asset.title}
                    fallbackSvg={
                      asset.category === "symbol"
                        ? POLYESTER_LOGOMARK_SVG
                        : asset.surface === "light"
                          ? POLYESTER_FULL_LOGO_LIGHT_SVG
                          : POLYESTER_FULL_LOGO_DARK_SVG
                    }
                  />
                </div>
                <div className="brand-asset-body">
                  <div className="between">
                    <strong>{asset.title}</strong>
                    <Pill>{asset.category}</Pill>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 10px", fontSize: 12 }}>
                    {asset.description}
                  </p>
                  <div className="row-flex" style={{ gap: 6 }}>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="btn sm"
                    >
                      Download SVG
                    </a>
                    <CopyButton text={asset.url} label="Copy URL" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 2. Token Packshots Library (All 15 Polyester Tokens) */}
      {showTokens && (
        <Card
          title="Token Packshots & Market Icons"
          subtitle="Use token packshots when a market or asset should be recognizable in product UI, pair art, and campaign stills. Each token is available in Front, Side, and Low-angle views."
          actions={
            <div className="row-flex" style={{ gap: 8 }}>
              <div className="input-group" style={{ width: 200 }}>
                <span className="input-icon">
                  <IconSearch size={14} />
                </span>
                <input
                  type="search"
                  className="input with-icon"
                  placeholder="Filter token (e.g. BTC)…"
                  aria-label="Filter token packshots"
                  value={tokenQuery}
                  onChange={(e) => setTokenQuery(e.target.value)}
                />
              </div>
              <div className="seg-group" role="group" aria-label="Select token packshot angle">
                {(
                  [
                    ["front", "Front"],
                    ["side", "Side"],
                    ["low-angle", "Low angle"],
                  ] as const
                ).map(([angle, label]) => (
                  <button
                    key={angle}
                    type="button"
                    className={`seg-btn ${tokenAngle === angle ? "active" : ""}`}
                    onClick={() => setTokenAngle(angle)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {filteredTokens.length === 0 ? (
            <BrandFilterEmptyState kind="token" query={tokenQuery} onClear={() => setTokenQuery("")} />
          ) : (
            <div className="brand-token-grid">
            {filteredTokens.map((token) => {
              const url = getTokenPackshotUrl(token.symbol, tokenAngle) ?? "";
              return (
                <div key={token.id} className="brand-token-card">
                  <div className="brand-token-stage">
                    <span className="brand-token-index mono">{token.id}</span>
                    <SymBadge asset={token.symbol} size={68} angle={tokenAngle} />
                    </div>
                  <div className="brand-token-meta">
                    <div className="between">
                      <div className="row-flex" style={{ gap: 6 }}>
                        <SymBadge asset={token.symbol} size={20} />
                        <strong>{token.symbol}</strong>
                      </div>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: token.color,
                          fontWeight: 600,
                        }}
                      >
                        {token.color}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {token.name} · <code className="mono">{token.slug}</code>
                    </div>
                    <div className="row-flex" style={{ gap: 6, marginTop: 10 }}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        download={`${token.slug}-${tokenAngle}.webp`}
                        className="btn sm"
                      >
                        Download ({tokenAngle})
                      </a>
                      <CopyButton text={url} label="URL" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </Card>
      )}

      {/* 3. Official Color Palette & Typography */}
      {showColors && (
        <div className="grid-2">
          <Card
            title="Official Brand Color Palette"
            subtitle="Exact OKLCH, RGB, and HEX values from the Polyester Brand Guidelines."
          >
            <div className="brand-swatch-list">
              {BRAND_COLORS.map((c, idx) => (
                <div key={`${c.name}-${idx}`} className="brand-swatch-row">
                  <div
                    className="brand-swatch-chip"
                    style={{
                      background: c.hex,
                      color: c.textOnColor,
                    }}
                  >
                    <span className="mono">{c.hex}</span>
                  </div>
                  <div className="brand-swatch-info">
                    <div className="between">
                      <strong>{c.name}</strong>
                      <div className="row-flex" style={{ gap: 4 }}>
                        <CopyButton text={c.hex} label="HEX" />
                        <CopyButton text={c.oklch} label="OKLCH" />
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {c.role}
                    </div>
                    <div className="mono faint" style={{ fontSize: 11, marginTop: 4 }}>
                      OKLCH: {c.oklch} · RGB: {c.rgb}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Typography — Inter Variable"
            subtitle="Primary UI and editorial typeface used across Polyester product, analytics, and documentation."
          >
            <div className="brand-type-specimen">
              <div className="brand-type-aa">Aa</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 650 }}>Inter Variable</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  Tabular numerals (<code className="mono">font-variant-numeric: tabular-nums</code>
                  ) for order books, spreads, and price feeds.
                </div>
              </div>
            </div>
            <div className="brand-alphabet mono">
              <div>Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm</div>
              <div>Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz</div>
              <div style={{ marginTop: 6, color: "var(--accent-text)" }}>
                0123456789 · $84,210.50 · +2.45% · 1.2 bps
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* 4. Imagery Stills & 3D Loops */}
      {showImagery && (
        <Card
          title="Imagery Stills & 3D Motion Loops"
          subtitle="Use imagery when a surface needs more than the logo: campaigns, social, and hero art. Includes Symbol lineup, Circuit, Infinite Power Loop, Farandole, Synchronism, and studio loops."
        >
          <div className="brand-logo-grid">
            {BRAND_IMAGERY_ASSETS.map((item) => (
              <div key={item.id} className="brand-asset-card">
                <div className="brand-asset-stage stage-dark">
                  {item.previewUrl ? (
                    <img
                      src={item.previewUrl}
                      alt={item.title}
                      className="brand-imagery-img"
                      loading="lazy"
                    />
                  ) : (
                    <div className="brand-loop-placeholder">
                      <span className="mono" style={{ color: "#FA2F6F", fontWeight: 700 }}>
                        ▶ 3D LOOP ({item.id})
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {item.title}
                      </span>
                    </div>
                  )}
                </div>
                <div className="brand-asset-body">
                  <div className="between">
                    <strong>
                      <span className="mono muted" style={{ marginRight: 6 }}>
                        {item.id}
                      </span>
                      {item.title}
                    </strong>
                    <Pill kind={item.kind === "still" ? "accent" : undefined}>
                      {item.variants ?? item.kind}
                    </Pill>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 10px", fontSize: 12 }}>
                    {item.description}
                  </p>
                  <div className="row-flex" style={{ gap: 6 }}>
                    <a
                      href={item.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="btn sm"
                    >
                      Download {item.kind === "still" ? "WebP" : "MP4"}
                    </a>
                    <CopyButton text={item.downloadUrl} label="Copy URL" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5. Polybot Avatars */}
      {showAvatars && (
        <Card
          title="Polybot Avatars"
          subtitle="Use Polybot avatars for profiles, social, and campaigns. Pick one character and keep that face consistent everywhere."
          actions={
            <div className="input-group" style={{ width: 210 }}>
              <span className="input-icon">
                <IconSearch size={14} />
              </span>
              <input
                type="search"
                className="input with-icon"
                placeholder="Search avatar (e.g. Orbital)…"
                aria-label="Filter Polybot avatars"
                value={avatarQuery}
                onChange={(e) => setAvatarQuery(e.target.value)}
              />
            </div>
          }
        >
          {filteredAvatars.length === 0 ? (
            <BrandFilterEmptyState kind="avatar" query={avatarQuery} onClear={() => setAvatarQuery("")} />
          ) : (
            <div className="brand-token-grid">
            {filteredAvatars.map((avatar) => (
              <div key={avatar.id} className="brand-token-card">
                <div className="brand-token-stage" style={{ padding: 12 }}>
                  <span className="brand-token-index mono">{avatar.id}</span>
                  <img
                    src={avatar.url}
                    alt={avatar.name}
                    className="brand-avatar-img"
                    loading="lazy"
                  />
                  </div>
                <div className="brand-token-meta">
                  <div className="between">
                    <strong>{avatar.name}</strong>
                    <span className="mono faint" style={{ fontSize: 11 }}>
                      PNG
                    </span>
                  </div>
                  <div className="row-flex" style={{ gap: 6, marginTop: 8 }}>
                    <a
                      href={avatar.url}
                      target="_blank"
                      rel="noreferrer"
                      download={`${avatar.slug}.png`}
                      className="btn sm"
                    >
                      Download PNG
                    </a>
                    <CopyButton text={avatar.url} label="URL" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          )}
        </Card>
      )}

      {/* 6. Partnerships (Zipper) & Polyester Scan */}
      {showPartners && (
        <Card
          title="Partnerships (Zipper) & Polyester Scan Explorer"
          subtitle="When Polyester sits next to a partner logo like Zipper, keep clear space so both marks stay readable and balanced: partner first, then Polyester, on one line."
          actions={
            <a
              href={SCAN_BRAND_KIT_ZIP_URL}
              target="_blank"
              rel="noreferrer"
              className="btn sm"
            >
              Download Scan Brand Kit (.zip)
            </a>
          }
        >
          <div className="brand-logo-grid">
            {partnerLogos.map((asset) => (
              <div key={asset.id} className="brand-asset-card">
                <div
                  className={`brand-asset-stage ${
                    asset.surface === "light" ? "stage-light" : "stage-dark"
                  }`}
                >
                  <LogoPreviewImage
                    url={asset.url}
                    title={asset.title}
                    fallbackSvg={POLYESTER_FULL_LOGO_DARK_SVG}
                  />
                </div>
                <div className="brand-asset-body">
                  <div className="between">
                    <strong>{asset.title}</strong>
                    <Pill>partner / scan</Pill>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 10px", fontSize: 12 }}>
                    {asset.description}
                  </p>
                  <div className="row-flex" style={{ gap: 6 }}>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="btn sm"
                    >
                      Download SVG
                    </a>
                    <CopyButton text={asset.url} label="Copy URL" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
