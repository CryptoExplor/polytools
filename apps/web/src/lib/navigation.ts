export type MoneyMovementScope = "mine" | "all";

export function accountRedirectTarget(
  to: string,
  currentSearch: string,
  scope?: "public",
): string {
  const params = new URLSearchParams(currentSearch);
  if (scope) params.set("scope", scope);
  const search = params.toString();
  return `${to}${search ? `?${search}` : ""}`;
}

export function moneyMovementScope(
  search: string | URLSearchParams,
): MoneyMovementScope {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("scope") === "public" ? "all" : "mine";
}

export function withMoneyMovementScope(
  search: string | URLSearchParams,
  scope: MoneyMovementScope,
): URLSearchParams {
  const params = new URLSearchParams(
    typeof search === "string" ? search : search.toString(),
  );
  if (scope === "all") params.set("scope", "public");
  else params.delete("scope");
  return params;
}
