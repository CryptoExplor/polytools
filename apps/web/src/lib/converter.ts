export interface ConverterPriceState {
  value: number;
  manual: boolean;
}

export type ConverterPriceAction =
  | { type: "edit"; value: number }
  | { type: "sync"; value: number; force?: boolean };

export const INITIAL_CONVERTER_PRICE_STATE: ConverterPriceState = {
  value: 82000,
  manual: false,
};

export function converterPriceReducer(
  state: ConverterPriceState,
  action: ConverterPriceAction,
): ConverterPriceState {
  switch (action.type) {
    case "edit":
      return { value: action.value, manual: true };
    case "sync":
      // Polling cannot overwrite a manual edit. The existing Sync Live Price
      // button passes force=true when the user explicitly resumes live values.
      if (state.manual && !action.force) return state;
      return { value: action.value, manual: false };
  }
}
