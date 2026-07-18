import type { FormState } from "./DevicePowerPanelControls";

export type OutputModeDraft = {
  tps_mode: FormState["tps_mode"];
  manual: Pick<
    FormState["manual"],
    "voltage_mv" | "current_limit_ma" | "tps_cdc_rise_mv" | "usb_c_path_mode"
  >;
};

export function extractOutputModeDraft(form: FormState): OutputModeDraft {
  return {
    tps_mode: form.tps_mode,
    manual: {
      voltage_mv: form.manual.voltage_mv,
      current_limit_ma: form.manual.current_limit_ma,
      tps_cdc_rise_mv: form.manual.tps_cdc_rise_mv,
      usb_c_path_mode: form.manual.usb_c_path_mode,
    },
  };
}

export function applyOutputModeDraft(
  form: FormState,
  draft: OutputModeDraft,
): FormState {
  return {
    ...form,
    tps_mode: draft.tps_mode,
    manual: {
      ...form.manual,
      ...draft.manual,
    },
  };
}

export function mergeNonOutputModeFields(
  canonicalForm: FormState,
  localForm: FormState,
): FormState {
  return {
    ...canonicalForm,
    light_load_mode: localForm.light_load_mode,
    sw2303_line_compensation: localForm.sw2303_line_compensation,
    capability: localForm.capability,
  };
}

export function serializeOutputModeDraft(draft: OutputModeDraft): string {
  return JSON.stringify(draft);
}
