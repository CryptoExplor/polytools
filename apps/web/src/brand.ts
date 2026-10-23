/**
 * Polyester Official Brand Kit & Token Asset Catalog
 * Source: https://testnet.polyester.com/platform/brand-kit-is-available
 *         https://testnet.polyester.com/brand-kit
 *         https://testnet.polyester.com/brand-kit/tokens
 *         https://testnet.polyester.com/brand-kit/imagery
 *         https://testnet.polyester.com/brand-kit/avatars
 *         https://testnet.scan.polyester.com/brand-kit
 */

export const BRAND_KIT_ZIP_URL =
  "https://assets.polyester.com/polyester-brand-kit/polyester-brand-assets.zip";

export const SCAN_BRAND_KIT_ZIP_URL =
  "https://assets.polyester.com/scan-brand-kit/polyester-scan-brand-kit.zip";

export const BRAND_ANNOUNCEMENT_URL =
  "https://testnet.polyester.com/platform/brand-kit-is-available";

export const BRAND_KIT_LIVE_URL = "https://testnet.polyester.com/brand-kit";

/* ---------- Official Brand Colors ---------- */

export interface BrandColorSpec {
  name: string;
  role: string;
  hex: string;
  rgb: string;
  oklch: string;
  textOnColor: "#FFFFFF" | "#0A0A0A";
}

export const BRAND_COLORS: BrandColorSpec[] = [
  {
    name: "Polyester Pink",
    role: "Primary brand accent, symbol highlight, & active key actions",
    hex: "#FA2F6F",
    rgb: "250, 47, 111",
    oklch: "oklch(0.647 0.235 9.4)",
    textOnColor: "#FFFFFF",
  },
  {
    name: "Polyester Black",
    role: "Primary dark canvas & high-contrast ink on light surfaces",
    hex: "#0A0A0A",
    rgb: "10, 10, 10",
    oklch: "oklch(0.145 0.000 89.8)",
    textOnColor: "#FFFFFF",
  },
  {
    name: "Polyester White",
    role: "Primary light canvas & crisp headline foreground on dark",
    hex: "#F7F7F7",
    rgb: "247, 247, 247",
    oklch: "oklch(0.976 0.000 89.8)",
    textOnColor: "#0A0A0A",
  },
  {
    name: "Surface Primary",
    role: "Elevated card & modal surface on light theme",
    hex: "#FFFFFF",
    rgb: "255, 255, 255",
    oklch: "oklch(1.000 0.000 89.8)",
    textOnColor: "#0A0A0A",
  },
  {
    name: "Surface Secondary",
    role: "Secondary container & lockup surface",
    hex: "#FFFFFF",
    rgb: "255, 255, 255",
    oklch: "oklch(1.000 0.000 89.8)",
    textOnColor: "#0A0A0A",
  },
];

/* ---------- Inline SVG Marks (For Instant Rendering, Copy SVG & Offline Fallback) ---------- */

export const POLYESTER_LOGOMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="16" fill="#FA2F6F"/>
  <path d="M19 46V18h14.5c6.35 0 11 4.15 11 10.25 0 6.1-4.65 10.25-11 10.25H26.5V46H19zm7.5-14.5h6.4c2.65 0 4.35-1.55 4.35-4s-1.7-4-4.35-4h-6.4v8z" fill="#FFFFFF"/>
  <circle cx="44.5" cy="42.5" r="4.5" fill="#FFFFFF"/>
</svg>`;

export const POLYESTER_FULL_LOGO_DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64" fill="none">
  <rect x="4" y="8" width="48" height="48" rx="12" fill="#FA2F6F"/>
  <path d="M18.5 44V20h11.5c5.1 0 8.8 3.3 8.8 8.2 0 4.9-3.7 8.2-8.8 8.2h-5.5V44h-6zm6-11.6h4.9c2.1 0 3.4-1.2 3.4-3.2s-1.3-3.2-3.4-3.2h-4.9v6.4z" fill="#FFFFFF"/>
  <circle cx="38.8" cy="41.2" r="3.6" fill="#FFFFFF"/>
  <text x="66" y="41" fill="#F7F7F7" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="700" font-size="27" letter-spacing="-0.8">Polyester</text>
</svg>`;

export const POLYESTER_FULL_LOGO_LIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64" fill="none">
  <rect x="4" y="8" width="48" height="48" rx="12" fill="#FA2F6F"/>
  <path d="M18.5 44V20h11.5c5.1 0 8.8 3.3 8.8 8.2 0 4.9-3.7 8.2-8.8 8.2h-5.5V44h-6zm6-11.6h4.9c2.1 0 3.4-1.2 3.4-3.2s-1.3-3.2-3.4-3.2h-4.9v6.4z" fill="#FFFFFF"/>
  <circle cx="38.8" cy="41.2" r="3.6" fill="#FFFFFF"/>
  <text x="66" y="41" fill="#0A0A0A" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="700" font-size="27" letter-spacing="-0.8">Polyester</text>
</svg>`;

/* ---------- Official Logo Lockup Assets ---------- */

export interface BrandLogoAsset {
  id: string;
  title: string;
  category: "lockup" | "symbol" | "wordmark" | "partner";
  surface: "dark" | "light" | "brand";
  url: string;
  description: string;
}

export const BRAND_LOGO_ASSETS: BrandLogoAsset[] = [
  {
    id: "full-dark",
    title: "Full Logo on Dark (Pink & White)",
    category: "lockup",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_LogoBrand_PinkWhite_Transparent.svg",
    description: "Primary full lockup with Polyester Pink symbol and white wordmark for dark surfaces.",
  },
  {
    id: "full-light",
    title: "Full Logo on Light (Pink & Black)",
    category: "lockup",
    surface: "light",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_LogoBrand_PinkBlack_Transparent.svg",
    description: "Primary full lockup with Polyester Pink symbol and black wordmark for light surfaces.",
  },
  {
    id: "full-pink",
    title: "Full Logo — Monochrome Pink",
    category: "lockup",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_LogoBrand_Pink_Transparent.svg",
    description: "Single-color Polyester Pink lockup (#FA2F6F).",
  },
  {
    id: "full-white",
    title: "Full Logo — Monochrome White",
    category: "lockup",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_LogoBrand_White_Transparent.svg",
    description: "All-white full logo lockup for high-contrast dark or brand-pink backgrounds.",
  },
  {
    id: "symbol-white-pink",
    title: "Symbol — White on Pink",
    category: "symbol",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/logomark.svg",
    description: "Primary app icon & avatar badge: white Polyester mark on #FA2F6F.",
  },
  {
    id: "symbol-light",
    title: "Symbol — Logomark on Light",
    category: "symbol",
    surface: "light",
    url: "https://assets.polyester.com/polyester-brand-kit/logomark-5.svg",
    description: "Logomark tuned for light paper/white backgrounds.",
  },
  {
    id: "symbol-bw",
    title: "Symbol — Black & White",
    category: "symbol",
    surface: "light",
    url: "https://assets.polyester.com/polyester-brand-kit/logomark-2.svg",
    description: "Monochrome black & white symbol mark.",
  },
  {
    id: "symbol-pink-black",
    title: "Symbol — Pink & Black",
    category: "symbol",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/logomark-3.svg",
    description: "Polyester Pink glyph on Polyester Black tile.",
  },
  {
    id: "symbol-white-black",
    title: "Symbol — White & Black",
    category: "symbol",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/logomark-4.svg",
    description: "White glyph on Polyester Black tile.",
  },
  {
    id: "wordmark-white",
    title: "Wordmark — White",
    category: "wordmark",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_WordMark_White_Transparent.svg",
    description: "Standalone Polyester wordmark in white.",
  },
  {
    id: "wordmark-black",
    title: "Wordmark — Black",
    category: "wordmark",
    surface: "light",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_WordMark_Black_Transparent.svg",
    description: "Standalone Polyester wordmark in black.",
  },
  {
    id: "wordmark-pink",
    title: "Wordmark — Pink",
    category: "wordmark",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/Polyester_WordMark_Pink_Transparent.svg",
    description: "Standalone Polyester wordmark in #FA2F6F.",
  },
  {
    id: "scan-full-dark",
    title: "Polyester Scan — Full Logo on Dark",
    category: "partner",
    surface: "dark",
    url: "https://assets.polyester.com/scan-brand-kit/scan-logo.svg",
    description: "Official Polyester Scan blockchain explorer full lockup on dark.",
  },
  {
    id: "scan-full-light",
    title: "Polyester Scan — Full Logo on Light",
    category: "partner",
    surface: "light",
    url: "https://assets.polyester.com/scan-brand-kit/scan-symbol-and-wordmark.svg",
    description: "Official Polyester Scan blockchain explorer full lockup on light.",
  },
  {
    id: "scan-symbol-pink",
    title: "Polyester Scan — Pink Symbol",
    category: "partner",
    surface: "dark",
    url: "https://assets.polyester.com/scan-brand-kit/scan-symbol-pink-clear.svg",
    description: "Standalone Polyester Scan explorer symbol mark.",
  },
  {
    id: "zipper-white",
    title: "Zipper Partner Wordmark",
    category: "partner",
    surface: "dark",
    url: "https://assets.polyester.com/polyester-brand-kit/zipper-logo-white.svg",
    description: "Official Zipper cross-chain partner mark for co-branded lockups.",
  },
];

/* ---------- Official Token Packshots & Vector Badges ---------- */

export type TokenViewAngle = "front" | "side" | "low-angle";

export interface TokenBrandSpec {
  id: string;
  symbol: string;
  aliases?: string[];
  name: string;
  slug: string;
  color: string;
  bgSoft: string;
  glyph: string;
}

export const TOKEN_BRAND_SPECS: TokenBrandSpec[] = [
  {
    id: "001",
    symbol: "AVAX",
    name: "Avalanche",
    slug: "avax",
    color: "#E84142",
    bgSoft: "rgba(232, 65, 66, 0.14)",
    glyph: "▲",
  },
  {
    id: "002",
    symbol: "BNB",
    name: "Binance Coin",
    slug: "binancecoin",
    color: "#F0B90B",
    bgSoft: "rgba(240, 185, 11, 0.14)",
    glyph: "◆",
  },
  {
    id: "003",
    symbol: "BTC",
    name: "Bitcoin",
    slug: "bitcoin",
    color: "#F7931A",
    bgSoft: "rgba(247, 147, 26, 0.15)",
    glyph: "₿",
  },
  {
    id: "004",
    symbol: "BCH",
    name: "Bitcoin Cash",
    slug: "bitcoin-cash",
    color: "#0AC18E",
    bgSoft: "rgba(10, 193, 142, 0.14)",
    glyph: "₿",
  },
  {
    id: "005",
    symbol: "DOGE",
    name: "Dogecoin",
    slug: "doge",
    color: "#C2A633",
    bgSoft: "rgba(194, 166, 51, 0.15)",
    glyph: "Ð",
  },
  {
    id: "006",
    symbol: "ETH",
    name: "Ethereum",
    slug: "ethereum",
    color: "#627EEA",
    bgSoft: "rgba(98, 126, 234, 0.15)",
    glyph: "Ξ",
  },
  {
    id: "007",
    symbol: "ETC",
    name: "Ethereum Classic",
    slug: "ethereum-classic",
    color: "#328332",
    bgSoft: "rgba(50, 131, 50, 0.15)",
    glyph: "ξ",
  },
  {
    id: "008",
    symbol: "HYPE",
    name: "Hyperliquid",
    slug: "hyperliquid",
    color: "#2EE59D",
    bgSoft: "rgba(46, 229, 157, 0.14)",
    glyph: "H",
  },
  {
    id: "009",
    symbol: "LTC",
    name: "Litecoin",
    slug: "litecoin",
    color: "#345D9D",
    bgSoft: "rgba(52, 93, 157, 0.16)",
    glyph: "Ł",
  },
  {
    id: "010",
    symbol: "POL",
    aliases: ["MATIC"],
    name: "Polygon (POL / MATIC)",
    slug: "matic",
    color: "#8247E5",
    bgSoft: "rgba(130, 71, 229, 0.15)",
    glyph: "⬡",
  },
  {
    id: "011",
    symbol: "XRP",
    name: "Ripple (XRP)",
    slug: "ripple",
    color: "#23292F",
    bgSoft: "rgba(148, 163, 184, 0.15)",
    glyph: "✕",
  },
  {
    id: "012",
    symbol: "SOL",
    name: "Solana",
    slug: "solana",
    color: "#14F195",
    bgSoft: "rgba(20, 241, 149, 0.14)",
    glyph: "◎",
  },
  {
    id: "013",
    symbol: "USDT",
    name: "Tether USD",
    slug: "tether",
    color: "#26A17B",
    bgSoft: "rgba(38, 161, 123, 0.15)",
    glyph: "₮",
  },
  {
    id: "014",
    symbol: "TRX",
    name: "TRON",
    slug: "tron",
    color: "#FF0013",
    bgSoft: "rgba(255, 0, 19, 0.14)",
    glyph: "◈",
  },
  {
    id: "015",
    symbol: "USDC",
    name: "USD Coin",
    slug: "usdc",
    color: "#2775CA",
    bgSoft: "rgba(39, 117, 202, 0.15)",
    glyph: "$",
  },
];

const TOKEN_BY_SYMBOL = new Map<string, TokenBrandSpec>();
for (const spec of TOKEN_BRAND_SPECS) {
  TOKEN_BY_SYMBOL.set(spec.symbol.toUpperCase(), spec);
  if (spec.aliases) {
    for (const alias of spec.aliases) {
      TOKEN_BY_SYMBOL.set(alias.toUpperCase(), spec);
    }
  }
}

export function getTokenBrandSpec(asset: string): TokenBrandSpec | undefined {
  if (!asset) return undefined;
  return TOKEN_BY_SYMBOL.get(asset.trim().toUpperCase());
}

export function getTokenPackshotUrl(
  assetOrSlug: string,
  angle: TokenViewAngle = "front",
): string | null {
  const upper = assetOrSlug.trim().toUpperCase();
  const bySymbol = TOKEN_BY_SYMBOL.get(upper);
  const slug =
    bySymbol?.slug ??
    TOKEN_BRAND_SPECS.find((t) => t.slug === assetOrSlug.trim().toLowerCase())?.slug;
  if (!slug) return null;
  return `https://assets.polyester.com/polyester-brand-kit/library/tokens/${angle}/${slug}.webp`;
}

/* ---------- Official Brand Imagery & Motion Loops ---------- */

export interface BrandImageryAsset {
  id: string;
  title: string;
  kind: "still" | "loop";
  variants?: string;
  previewUrl?: string;
  downloadUrl: string;
  description: string;
}

export const BRAND_IMAGERY_ASSETS: BrandImageryAsset[] = [
  {
    id: "001",
    title: "Symbol Lineup",
    kind: "still",
    previewUrl: "https://assets.polyester.com/polyester-brand-kit/imagery/welcome-logo-bottom.webp",
    downloadUrl: "https://assets.polyester.com/polyester-brand-kit/imagery/welcome-logo-bottom.webp",
    description: "Token spheres arranged in a row with the Polyester logo underneath.",
  },
  {
    id: "002",
    title: "Circuit",
    kind: "still",
    previewUrl: "https://assets.polyester.com/polyester-brand-kit/imagery/circuit.webp",
    downloadUrl: "https://assets.polyester.com/polyester-brand-kit/imagery/circuit.webp",
    description: "High-precision 3D circuit still for technical & infrastructure surfaces.",
  },
  {
    id: "003",
    title: "Infinite Power Loop",
    kind: "loop",
    variants: "Dark / Light",
    previewUrl: "https://assets.polyester.com/polyester-brand-kit/InfinitePowerLoop/Loop_Dark_poster.webp",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/infinitepowerloop/loop-dark.mp4",
    description: "Signature continuous loop poster & H.264 motion piece.",
  },
  {
    id: "004",
    title: "Farandole",
    kind: "loop",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/farandole/farandole-h264.mp4",
    description: "3D motion loop of synchronized token spheres in orbit.",
  },
  {
    id: "005",
    title: "Synchronism",
    kind: "loop",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/synchronism/synchronism-h264.mp4",
    description: "Precision kinetic motion piece for hero & launch campaigns.",
  },
  {
    id: "006",
    title: "SH090 · Loop",
    kind: "loop",
    variants: "3 Variants",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/sh090/loop-sh090-h264.mp4",
    description: "Seamless 3D studio loop (16:9 and 1:1 social cuts).",
  },
  {
    id: "007",
    title: "Logo Reveal",
    kind: "loop",
    variants: "Dark / Light",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/logoreveal/logoreveal-dark.mp4",
    description: "Animated Polyester logo reveal in dark and light variants.",
  },
  {
    id: "008",
    title: "Game On",
    kind: "loop",
    variants: "Dark / Light",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/gameon/gameon-dark.mp4",
    description: "Billiards-inspired token collision motion loop.",
  },
  {
    id: "009",
    title: "Marching Balls",
    kind: "loop",
    variants: "5 Variants",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/marchingballs/marchingballs-h264.mp4",
    description: "Rhythmic token sphere procession loop.",
  },
  {
    id: "010",
    title: "Dolly Zoom",
    kind: "loop",
    variants: "Mixed",
    downloadUrl:
      "https://assets.polyester.com/polyester-brand-kit/library/3d-assets/dollyzoom/dollyzoom-h264.mp4",
    description: "Perspective dolly zoom 3D motion piece.",
  },
];

/* ---------- Official Polybot Avatars ---------- */

export interface PolybotAvatarAsset {
  id: string;
  name: string;
  slug: string;
  url: string;
}

export const POLYBOT_AVATARS: PolybotAvatarAsset[] = [
  {
    id: "001",
    name: "Orbital",
    slug: "02-orbital",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/02-orbital.png",
  },
  {
    id: "002",
    name: "Racer",
    slug: "03-racer",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/03-racer.png",
  },
  {
    id: "003",
    name: "DJ",
    slug: "04-dj",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/04-dj.png",
  },
  {
    id: "004",
    name: "Surf",
    slug: "05-surf",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/05-surf.png",
  },
  {
    id: "005",
    name: "Explorer",
    slug: "06-explorer",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/06-explorer.png",
  },
  {
    id: "006",
    name: "Chef",
    slug: "09-chef",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/09-chef.png",
  },
  {
    id: "007",
    name: "Rain",
    slug: "10-rain",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/10-rain.png",
  },
  {
    id: "008",
    name: "Abyss",
    slug: "11-abyss",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/11-abyss.png",
  },
  {
    id: "009",
    name: "Aviator",
    slug: "12-aviator",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/12-aviator.png",
  },
  {
    id: "010",
    name: "Moonmage",
    slug: "13-moonmage",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/13-moonmage.png",
  },
  {
    id: "011",
    name: "Ronin",
    slug: "14-ronin",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/14-ronin.png",
  },
  {
    id: "012",
    name: "Cyber",
    slug: "23-cyber",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/23-cyber.png",
  },
  {
    id: "013",
    name: "Solar",
    slug: "28-solar",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/28-solar.png",
  },
  {
    id: "014",
    name: "Margin Call",
    slug: "31-margin-call",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/31-margin-call.png",
  },
  {
    id: "015",
    name: "Moonshot",
    slug: "41-moonshot",
    url: "https://assets.polyester.com/polyester-brand-kit/library/avatars/41-moonshot.png",
  },
];
