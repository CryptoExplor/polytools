/**
 * Friendly labels for the finalized ledger transfer contract.
 *
 * The unspecified enum value is deliberately not a known activity: treating it
 * as a deposit, trade, or fee would invent financial meaning.
 */
export const TRANSFER_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  DEPOSIT: "Deposit",
  WITHDRAW: "Withdrawal",
  MAKER_FEE: "Maker fee",
  TAKER_FEE: "Taker fee",
  INTERNAL_TRANSFER: "Internal transfer",
  TRADE_BASE: "Trade — base asset",
  TRADE_QUOTE: "Trade — quote asset",
  REBATE: "Rebate",
  FUNDING_TO_TRADING: "Funding → trading",
  TRADING_TO_FUNDING: "Trading → funding",
  TRADING_WITHDRAW_RESERVE: "Withdrawal reserve",
  FUNDING_USER_TRANSFER: "Funding user transfer",
  TRADING_WITHDRAW_REQUEST_FEE: "Withdrawal request fee",
});

export interface TransferReason {
  known: boolean;
  label: string;
}

export function resolveTransferReason(code: string): TransferReason {
  if (Object.prototype.hasOwnProperty.call(TRANSFER_REASON_LABELS, code)) {
    return { known: true, label: TRANSFER_REASON_LABELS[code] };
  }
  return { known: false, label: "Unknown activity" };
}

const TRANSFER_SIDE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  FUNDING_ACCOUNT: "Funding account",
  TRADING_ACCOUNT: "Trading account",
  EXTERNAL_ADDRESS: "External address",
  PRIVATE_COUNTERPARTY: "Private counterparty",
  FEE_ACCOUNT: "Fee account",
  SYSTEM_ACCOUNT: "System account",
});

/** Display/export only a category, never a counterparty address or account ID. */
export function transferSideLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(TRANSFER_SIDE_LABELS, kind)
    ? TRANSFER_SIDE_LABELS[kind]
    : "Unknown side";
}

/** The account field is a bucket code, not an account identifier. */
export function transferBucketLabel(account: string): string {
  const normalized = account.toUpperCase();
  if (normalized === "TRADING" || normalized === "TRADING_ACCOUNT") return "Trading";
  if (normalized === "FUNDING" || normalized === "FUNDING_ACCOUNT") return "Funding";
  return "Unknown bucket";
}
