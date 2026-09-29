import React, { useState, useRef, useEffect } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Divider,
  MenuItem,
  LinearProgress,
  Switch,
  Alert,
  Typography,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { csvParse } from "d3-dsv";

import { thermompnnResults } from "../../analysis/thermompnnResults";
import { getPdbChains } from "../../utils/pdb";

import slivka from "../../analysis/slivka.js";
import { usePinger } from "../../Pinger";
import { parseStructureData } from "../../structureView/utils";

import { useSlivka } from "../../czekolada/lib";

export const TamarindThermoMPNNDialog = (props) => {
  const { open, onClose, passedProps } = props;
  const { columnarData, soloSelection, structureKeys, onDataLoad } =
    passedProps;

  const loadVersion = useRef(0);
  const [structureLoading, setStructureLoading] = useState(false);
  useEffect(
    () => () => {
      loadVersion.current += 1;
    },
    [],
  );
  const [structureRaw, setStructureRaw] = useState(null);
  const [structureDataBlob, setStructureDataBlob] = useState(null);
  const [dataErr, setDataErr] = useState(null);
  const [jobName, setJobName] = useState("");
  const [analysisRunning, setAnalysisRunning] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null);
  const [chainData, setChainData] = useState(null);
  const [chain, setChain] = useState("");
  const [allChains, setAllChains] = useState(false);
  const [topK, setTopK] = useState(10);

  const availStructureKeys = structureKeys.filter(
    (k) => !!columnarData[k] && !!columnarData[k][soloSelection],
  );
  const [structureKey, setStructureKey] = useState(null);

  const reset = () => {
    loadVersion.current += 1;
    setStructureLoading(false);
    setStructureRaw(null);
    setStructureDataBlob(null);
    setDataErr(null);
    setJobName("");
    setAnalysisError(null);
    setChainData(null);
    setChain("");
    setStructureKey(null);
  };

  const onHide = () => {
    onClose();
    reset();
  };

  const selectStructure = async (key) => {
    const version = ++loadVersion.current;
    setStructureKey(key);
    setStructureDataBlob(null);
    setStructureRaw(null);
    setChainData(null);
    setChain("");
    setDataErr(null);
    setStructureLoading(true);
    try {
      const structureData = columnarData[key]?.[soloSelection];
      if (!structureData)
        throw Error("Select or attach a PDB structure first.");
      const { structureText, format } = await parseStructureData(structureData);
      if (format !== "pdb")
        throw Error(
          "ThermoMPNN requires a PDB file. Attach a PDB structure or reimport the UniProt entry.",
        );
      const chains = await getPdbChains(structureText);
      if (!Object.keys(chains).length)
        throw Error("This PDB file contains no usable chains.");
      if (version !== loadVersion.current) return;
      setChainData(chains);
      setStructureDataBlob(
        new Blob([structureText], { type: "chemical/x-pdb" }),
      );
      setStructureRaw(structureData);
    } catch (err) {
      if (version === loadVersion.current) {
        setStructureKey(null);
        setDataErr(err.message || String(err));
      }
    } finally {
      if (version === loadVersion.current) setStructureLoading(false);
    }
  };
  useEffect(() => {
    // Cancel in-flight loads when the dialog closes or the selected sequence changes.
    reset();
  }, [open, soloSelection]);
  const [numResults, setNumResults] = useState(100);
  const [useAllResults, setUseAllResults] = useState(true);
  const canRun =
    !structureLoading &&
    !analysisRunning &&
    !dataErr &&
    !!structureDataBlob &&
    (allChains || (!!chain && !!chainData?.[chain])) &&
    Number.isInteger(Number(topK)) &&
    Number(topK) >= 1 &&
    Number(topK) <= 10000 &&
    (useAllResults ||
      (Number.isInteger(Number(numResults)) &&
        Number(numResults) >= 1 &&
        Number(numResults) <= 10000));

  const pinger = usePinger();

  const slivkaService = useSlivka();

  const runThermoMPNN = async () => {
    if (!canRun) return;
    try {
      pinger("analysis.thermompnn");

      setAnalysisRunning(true);
      setAnalysisError(undefined);

      const formData = new FormData();
      const structureBlob = new Blob([structureDataBlob], {
        type: "chemical/x-pdb",
      });

      formData.append("input", structureBlob, "input.pdb");
      if (!allChains) formData.append("chain", chain);
      formData.append("allChains", String(allChains));
      formData.append("topK", String(topK));

      const [{ data: results }] = await slivka(
        slivkaService,
        "thermompnn",
        formData,
        [{ label: "Mutations stability prediction", type: "text" }],
        {
          useCache: true,
          statusCallback: (status) => setAnalysisStatus(status),
        },
      );

      onDataLoad(
        undefined,
        thermompnnResults(
          csvParse(results),
          chainData,
          allChains ? Object.keys(chainData).sort() : [chain],
          structureRaw,
          jobName,
          useAllResults ? null : Number(numResults),
        ),
      );
      setAnalysisRunning(false);
    } catch (err) {
      setAnalysisRunning(false);
      setAnalysisError(err.message || err);
    }
  };

  let chainList;
  if (chainData) chainList = Object.keys(chainData);

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      open={open}
      onClose={analysisRunning ? undefined : onHide}
    >
      <DialogTitle>
        Run ThermoMPNN
        <IconButton
          disabled={!!analysisRunning}
          aria-label="close"
          onClick={onHide}
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
          }}
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          width: "100%",
          boxSizing: "border-box",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <Typography color="text.secondary">
          Predict how mutations affect protein stability using Tamarind compute.
        </Typography>
        {structureLoading && <LinearProgress aria-label="Loading structure" />}
        {!availStructureKeys.length && (
          <p>Attach a PDB structure before running ThermoMPNN.</p>
        )}
        <TextField
          size="small"
          disabled={!!analysisRunning}
          id="rasp-structure-select"
          label="Select structure"
          value={structureKey ? structureKey : ""}
          style={{ width: "12rem" }}
          margin="dense"
          select
          onChange={(ev) => selectStructure(ev.target.value)}
        >
          {availStructureKeys.map((k) => (
            <MenuItem key={k} value={k}>
              {k}
            </MenuItem>
          ))}
        </TextField>

        {!!structureDataBlob && chainList.length > 0 ? (
          <React.Fragment>
            <Divider />
            <Typography variant="body2" color="text.secondary">
              {chainList
                .map(
                  (c) =>
                    `Chain ${c}: ${chainData[c].rawAtomicSequence.length} residues`,
                )
                .join(" · ")}
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={allChains}
                  disabled={!!analysisRunning}
                  onChange={(ev) => setAllChains(ev.target.checked)}
                />
              }
              label="Keep all chains in context"
            />
            <Typography variant="body2" color="text.secondary">
              {allChains
                ? "Tamarind will scan mutations across all chains together."
                : "Choose one chain to scan."}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} gap="16px">
              <TextField
                size="small"
                disabled={allChains || !!analysisRunning}
                id="round-select"
                label="Chain to analyse"
                value={chain || ""}
                sx={{ minWidth: { xs: "100%", sm: "11rem" } }}
                select
                error={!allChains && !!chainData && !chain}
                helperText={
                  allChains || chain || !chainData
                    ? undefined
                    : "Select a chain"
                }
                onChange={(ev) => setChain(ev.target.value)}
              >
                {(chainList || []).map((chain) => (
                  <MenuItem key={chain} value={chain}>
                    {chain}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                disabled={!!analysisRunning}
                label="Job name"
                fullWidth
                type="text"
                value={jobName}
                onKeyDown={(ev) => ev.stopPropagation()}
                onChange={(ev) => setJobName(ev.target.value)}
              />
            </Stack>
            <TextField
              size="small"
              label="Max sequences"
              type="number"
              value={topK}
              disabled={!!analysisRunning}
              inputProps={{ min: 1, max: 10000, step: 1 }}
              onChange={(ev) => setTopK(ev.target.value)}
              helperText="Maximum sequences in Tamarind's ranked sequence output. Does not limit the stability scan."
            />
            <Divider />
            <Typography variant="subtitle2">GYDE results</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={useAllResults}
                  disabled={!!analysisRunning}
                  onChange={(ev) => setUseAllResults(ev.target.checked)}
                />
              }
              label="Import all mutations"
            />
            {!useAllResults && (
              <TextField
                size="small"
                label="Maximum mutations to import"
                type="number"
                value={numResults}
                disabled={!!analysisRunning}
                inputProps={{ min: 1, max: 10000, step: 1 }}
                onChange={(ev) => setNumResults(ev.target.value)}
                helperText="Keep the mutations with the lowest predicted ddG."
              />
            )}
            <Typography variant="caption" color="text.secondary">
              AlphaFold verification is a separate workflow and is not submitted
              from this dialog.
            </Typography>
          </React.Fragment>
        ) : null}
        {dataErr ? <Alert severity="error">{dataErr}</Alert> : null}
        {analysisError ? <Alert severity="error">{analysisError}</Alert> : null}
        {analysisRunning ? (
          <div>
            <div
              style={{
                textAlign: "center",
                paddingBottom: "4px",
                fontWeight: "700",
                color: "#777777",
              }}
            >
              {analysisStatus}
            </div>
            <LinearProgress />
          </div>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button
          variant={"contained"}
          onClick={runThermoMPNN}
          disabled={!canRun}
        >
          Run
        </Button>
        <Button disabled={!!analysisRunning} onClick={onHide}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
};
