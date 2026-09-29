import React from "react";
import { Checkbox, FormControlLabel } from "@mui/material";
import { usePredictionOptions } from "../../structureView/PredictDialogs";
export { translateGydeRestraints } from "./tamarindRestraintMapping";

export function TamarindRestraintControls({ hasRestraints }) {
  const [options, update] = usePredictionOptions();
  return hasRestraints ? (
    <FormControlLabel
      label="Use restraints"
      control={
        <Checkbox
          checked={options.useRestraints ?? false}
          onChange={(event) => update({ useRestraints: event.target.checked })}
        />
      }
    />
  ) : (
    <div>
      No restraints currently configured. Use “Create restraint” on the
      sequences menu to add them.
    </div>
  );
}
