/**
 * App-wide store: market metadata (once, cached), selected symbol,
 * environment info. No external state lib needed at this scale.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PairInfo, SpotMarketsResult, AssetInfo } from "@poly/core";
import { api, type EnvInfo } from "./api";

interface AppState {
  markets: SpotMarketsResult | null;
  pairs: PairInfo[];
  assets: AssetInfo[];
  pairBySymbol: Map<string, PairInfo>;
  symbols: string[];
  apiEnv: string;
  envInfo: EnvInfo | null;
  marketsError: string | null;
  symbol: string;
  setSymbol: (s: string) => void;
}

const Ctx = createContext<AppState | null>(null);

const SYMBOL_KEY = "poly-tools:symbol";

export function AppProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<SpotMarketsResult | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [symbol, setSymbolState] = useState<string>(
    () => localStorage.getItem(SYMBOL_KEY) ?? "BTC-USDT",
  );

  useEffect(() => {
    let alive = true;
    api
      .markets()
      .then((m) => alive && setMarkets(m))
      .catch((e) => alive && setMarketsError(e instanceof Error ? e.message : "failed"));
    api.env().then((e) => alive && e && setEnvInfo(e));
    return () => {
      alive = false;
    };
  }, []);

  const pairs = useMemo(() => markets?.pairs ?? [], [markets]);
  const assets = useMemo(() => markets?.assets ?? [], [markets]);
  const symbols = useMemo(() => pairs.map((p) => p.symbol), [pairs]);
  const pairBySymbol = useMemo(
    () => new Map(pairs.map((p) => [p.symbol, p])),
    [pairs],
  );

  // If stored symbol isn't listed, fall back to the first pair.
  useEffect(() => {
    if (symbols.length && !symbols.includes(symbol)) {
      setSymbolState(symbols.includes("BTC-USDT") ? "BTC-USDT" : symbols[0]);
    }
  }, [symbols, symbol]);

  const setSymbol = useCallback((s: string) => {
    setSymbolState(s);
    localStorage.setItem(SYMBOL_KEY, s);
  }, []);

  const value: AppState = {
    markets,
    pairs,
    assets,
    pairBySymbol,
    symbols,
    apiEnv: markets?.apiEnv ?? "testnet",
    envInfo,
    marketsError,
    symbol,
    setSymbol,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
