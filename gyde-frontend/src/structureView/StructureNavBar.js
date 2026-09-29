import {isTamarindCompute} from '../compute';
import {predictionMenuLabel} from '../integrations/tamarind/TamarindPredictionLayout';
import React, { useState, useCallback, useMemo } from "react";
import {createPortal} from 'react-dom';
import { saveAs } from "file-saver";
import { zipSync } from "fflate";
import {
    Button, CircularProgress, IconButton, Menu, MenuItem, Stack, TextField, Radio, ListItemText, Checkbox,
    FormControlLabel, Tooltip
} from "@mui/material";
import { ArrowDropDown, Download, ArrowRight, Visibility, Cancel } from "@mui/icons-material";

import { PdbUploadButton } from './PdbUploadButton';
import { navbarButtonCSS } from "../NavBar";
import GMenu, { GMenuItem, GDropDown, GSubMenu } from '../utils/GMenu';
import { getStructureBlob, structureDownloadFilename, structureDownloadFormat } from "./utils";

import {useSlivka} from '../czekolada/lib';

export const StructureNavBar = (props) => {
    // selection mode control
    const [selectByAnchor, setSelectByAnchor] = useState(null);
    const selectByOnClick = useCallback((ev) => {
        setSelectByAnchor(ev.currentTarget);
    }, []);
    const selectByOnClose = useCallback((ev) => {
        setSelectByAnchor(null);
    }, []);

    // structure prediction menu
    const [structurePredictionAnchor, setStructurePredictionAnchor] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState(null);

    const structurePredictionMenuOnClick = (event) => {
        setStructurePredictionAnchor(event.currentTarget);
    }

    const structurePredictionMenuOnClose = () => {
        setStructurePredictionAnchor(null);
    }

    const buttonStyle = {
        ...navbarButtonCSS, 
        fontSize: props.compact ? '10px' : '14px',
        padding: props.compact ? '1px' : null,
        borderRadius: props.compact ? '5px' : '10px'
    }

    const predictionButtonStyle = {
        ...navbarButtonCSS, 
        fontSize: props.sequenceCompact ? '10px' : '14px',
        padding: props.sequenceCompact ? '1px' : null,
        borderRadius: props.sequenceCompact ? '5px' : '10px'
    }

    const downloadStructures = useCallback(async () => {
        const structureInfos = props.structureInfos || [];
        if (!structureInfos.length || downloadProgress) return;

        const usedNames = new Set();
        const files = [];
        const failures = [];

        for (let i = 0; i < structureInfos.length; ++i) {
            const si = structureInfos[i];
            setDownloadProgress(`${i + 1}/${structureInfos.length}`);
            try {
                const structureBlob = await getStructureBlob(si.url);
                const format = structureDownloadFormat(si, structureBlob);
                const filename = structureDownloadFilename(si, format, usedNames);
                files.push({ filename, blob: structureBlob });
            } catch (err) {
                failures.push({
                    label: si.rowName || si.structureLabel || si.structureKey || `structure ${i + 1}`,
                    message: err?.message || String(err)
                });
            }
        }

        try {
            if (files.length === 1) {
                saveAs(files[0].blob, files[0].filename);
            } else if (files.length > 1) {
                const entries = {};
                for (const { filename, blob } of files) {
                    entries[filename] = new Uint8Array(await blob.arrayBuffer());
                }
                const zipped = zipSync(entries);
                saveAs(new Blob([zipped], { type: 'application/zip' }), 'structures.zip');
            }
        } catch (err) {
            failures.push({ label: 'zip', message: err?.message || String(err) });
        }

        setDownloadProgress(null);

        if (failures.length) {
            const lines = failures.slice(0, 8).map((f) => `${f.label}: ${f.message}`);
            if (failures.length > 8) lines.push(`…and ${failures.length - 8} more`);
            alert(`Downloaded ${files.length}/${structureInfos.length} structures.\n\n${lines.join('\n')}`);
        }
    }, [props.structureInfos, downloadProgress]);

    return (
        <React.Fragment>
            <Stack direction='row' 
                sx={{
                    alignItems: 'stretch',
                    gap: props.compact ? '0px' : '5px',
                    mb: '5px'
                }}
            >
                <GDropDown name={(props.hasReference ? props.structureSequence : null) === 'ref' ? 'Reference sequence' : 'Selected sequence'}
                           id="seq-select"
                           compact={props.compact}>

                    <GMenuItem onClick={() => {props.setStructureSequence('selected')}}>Selected sequence</GMenuItem>                
                    { props.hasReference 
                        ? <GMenuItem onClick={() => {props.setStructureSequence('ref')}}>Reference sequence</GMenuItem> 
                        : undefined }
                </GDropDown>
                <StructureSelectionMenu
                    compact={props.compact}
                    
                    selection={props.selection}
                    availStructureKeys={props.availStructureKeys}
                    visibleStructures={props.visibleStructures}
                    toggleStructureVisibility={props.toggleStructureVisibility}
                />
                <ColorByMenu
                    compact={props.compact}

                    setColorScheme={props.setStructureColorScheme}
                    colorScheme={props.colorScheme}
                    isHeatmapVisible={props.isHeatmapVisible}
                    isAntibody={props.isAntibody}
                    hasPLDDT={props.hasPLDDT}
                />
                <Button
                    sx={buttonStyle}
                    onClick={(ev) => {
                        props.setAutoSuperpose(!props.autoSuperpose)
                    }}
                >
                    <Checkbox
                        sx={{padding: '0px'}}
                        checked={!!props.autoSuperpose}
                    />
                    Auto-superpose
                </Button>
                <Button
                    disabled={!!downloadProgress || !props.structureInfos || props.structureInfos.length === 0}
                    sx={buttonStyle}
                    onClick={downloadStructures}
                >
                    {downloadProgress ? `Downloading ${downloadProgress}…` : 'Download structures'}
                    {downloadProgress
                        ? <CircularProgress size={12} sx={{ml: '6px'}}/>
                        : <Download sx={{fontSize: props.compact ? '16px' : 'auto'}}/>}
                </Button>
                <PdbUploadButton
                    columnarData={props.columnarData}
                    selection={props.selection}
                    structureKeys={props.structureKeys}
                    addValueToNewStructureColumn={props.addValueToNewStructureColumn}
                    setVisibleStructures={props.setVisibleStructures}
                    style={buttonStyle}
                    compact={props.compact}
                />
            </Stack>
            { props.primaryNavBarExtras.current
              ? createPortal(

                    <StructurePredictionMenu
                        anchor={structurePredictionAnchor}
                        onClose={structurePredictionMenuOnClose}
                        onShow={structurePredictionMenuOnClick}
                        style={predictionButtonStyle}

                        isAntibody={props.isAntibody}
                        predictionKey={props.predictionKey}
                        structureInfos={props.structureInfos}
                        predictionsPending={props.predictionsPending}
                        predictionsStatus={props.predictionsStatus}
                        predictionsJobInfo={props.predictionsJobInfo}
                        predictionMethods={props.predictionMethods}
                        cancelPrediction={props.cancelPrediction}
                        setViewingJob={props.setViewingJob}
                    />,
                    props.primaryNavBarExtras.current
                )
              : undefined }
        </React.Fragment>
    );
}

const StructureSelectionMenu = (props) => {
    const {
        compact, availStructureKeys, visibleStructures, toggleStructureVisibility, selection
    } = props;

    return (
        <GDropDown name="Show structures"
                   id="structure-select-menu"
                   compact={compact}>
            { availStructureKeys.map((k) => (
                <GMenuItem
                    onClick={() => toggleStructureVisibility(k)}
                    noClose
                    key={k} 
                    value={k}
                >
                    <Checkbox checked={visibleStructures.indexOf(k) > -1}/>
                    <ListItemText>{k}</ListItemText>
                </GMenuItem>
            )) }
        </GDropDown>
    )
}

const ColorByMenu = (props) => {
    const {
        compact, colorScheme, setColorScheme, isHeatmapVisible, isAntibody, hasPLDDT
    } = props;

    return (
        <GDropDown name={`Color by: ${colorScheme || '-'}`}
                   id="structure-color-by-menu"
                   compact={compact}>
            <GMenuItem
                value='Chain'
                onClick={() => {
                    setColorScheme('chain');
                }}>
                Chain
            </GMenuItem>
            <GMenuItem
                value='CDRs'
                disabled={!isAntibody}
                onClick={() => {
                    setColorScheme('CDRs');
                }}>
                CDRs
            </GMenuItem>
            <GMenuItem value="pLDDT"
                      disabled={!hasPLDDT}
                      onClick={() => {
                          setColorScheme('pLDDT');
                      }}>
                pLDDT
            </GMenuItem>
            <GMenuItem value="Diffs to reference"
                       onClick={() => {setColorScheme('Diffs to reference')}}>
                Diffs to reference
            </GMenuItem>
            <HeatmapMetricMenu
                isHeatmapVisible={isHeatmapVisible}
                setColorScheme={setColorScheme}
                colorScheme={colorScheme}
            />
        </GDropDown>
    )
}


const HeatmapMetricMenu = (props) => {
    const {
        setColorScheme, colorScheme, isHeatmapVisible, 
    } = props;

    return (
        <GSubMenu disabled={!isHeatmapVisible}
                  id="coloring-metrics-menu"
                  name="Heatmap">
            { ['average', 'variance', 'max', 'min'].map((metric) => (
                <GMenuItem
                    key={metric}
                    noClose
                    onClick={() => {
                        setColorScheme('heatmap ' + metric);
                    }}
                >
                    <Radio checked={colorScheme.includes(metric)}/>
                    <ListItemText>{metric}</ListItemText>
                </GMenuItem>
            ))}
        </GSubMenu>
    )
}

const StructurePredictionMenu = (props) => {
    const {
        anchor, onShow, onClose, runABuilder, isAntibody, predictionPending, predictionKey,
        style, structureInfos, predictionsPending, predictionsStatus, predictionsJobInfo,
        predictionMethods, cancelPrediction, setViewingJob
    } = props;
    const isOpen = !!anchor;

    const [groupOpen, setGroupOpen] = useState();
    const [groupMenuAnchor, setGroupMenuAnchor] = useState();
    const slivkaService = useSlivka();
    const services = new Set((slivkaService.services || []).map((s) => s.id));

    function methodStatus(methodKey) {
        const methodStatus = predictionsStatus[methodKey] || {},
              methodPending = predictionsPending[methodKey] || {};

        const status = structureInfos.map(({predictionKey}) => methodStatus[predictionKey]).filter((a) => a)[0];
        const pending = structureInfos.map(({predictionKey}) => methodPending[predictionKey]).reduce((a, b) => a || b, false);

        return [pending, status];
    }

    function methodJobInfoForKey(methodKey) {
        const methodJobs = (predictionsJobInfo || {})[methodKey] || {};
        for (const si of (structureInfos || [])) {
            const ji = methodJobs[si.predictionKey];
            if (ji?.jobId) return ji;
        }
        return null;
    }

    const hasPredictableAntibodies = structureInfos?.some((si) => si.hc && si.lc),
          hasPredictableVHH = structureInfos?.some((si) => si.hc && !si.lc);

    const preds = predictionMethods.
        filter((pred) => (!pred.gateOnService || services.has(pred.gateOnService)) && pred.enabled).
        map((pred) => {
            const [pending, status] = methodStatus(pred.key);
            const jobInfo = methodJobInfoForKey(pred.key);

            let available = (structureInfos || []).filter((si) => si.proteinSequences.length > 0).length > 0;
            if (typeof(pred.available) !== 'undefined') {
                if (pred.available === true) {
                    // noop
                } else if (pred.available === 'antibody') {
                    available = available && isAntibody && hasPredictableAntibodies
                } else if (pred.available === 'vhh') {
                    available = available && isAntibody && hasPredictableVHH
                } else if (pred.available === 'molecules') {
                    available = (structureInfos || []).filter((si) => si.sequences.length > 0 || si.ligands?.length > 0).length > 0;
                } else {
                    available = false;
                }
            }

            return {
                enabled: true,
                ...pred,
                pending,
                status,
                available,
                jobInfo
            }

        });

    const anyPending = preds.some((p) => p.pending);

    const {defaultPreds, groupPreds} = useMemo(() => {
        const defaultPreds = [];
        const groupPreds = {};

        for (const p of preds) {
            const g = p.group;
            if (g) {
                if (!groupPreds[g]) groupPreds[g] = [];
                groupPreds[g].push(p);
            } else {
                defaultPreds.push(p);
            }
        }

        return {defaultPreds, groupPreds};
    }, [preds]);

    function handleViewJob(ev, jobInfo) {
        ev.stopPropagation();
        if (setViewingJob && jobInfo?.jobUrl) {
            const toks = jobInfo.jobUrl.split('/');
            setViewingJob(toks[toks.length - 1], jobInfo.jobUrl);
        }
    }

    function handleCancelJob(ev, methodKey, predKey) {
        ev.stopPropagation();
        if (cancelPrediction) {
            cancelPrediction(methodKey, predKey);
        }
    }

    function predMenu(preds) {
        return preds.map(({name, callback, pending, status, available, enabled, key: methodKey, jobInfo}, idx) => {
            const pendingPredKeys = structureInfos
                ?.map((si) => si.predictionKey)
                .filter((pk) => (predictionsPending[methodKey] || {})[pk]);
            const firstPendingPredKey = pendingPredKeys?.[0];

            return (
                <MenuItem key={name}
                          onClick={() => callback()}
                          disabled={predictionPending || pending || !available}
                          sx={{gap: '6px'}} >
                    <span style={{flex: 1}}>{predictionMenuLabel(name, isTamarindCompute())}</span>
                    { pending
                        ? <React.Fragment>
                              <CircularProgress size={12} />
                              {status ? <span style={{fontSize: '11px', color: '#666'}}>{status}</span> : undefined}
                              { jobInfo
                                ? <React.Fragment>
                                      <Tooltip title="View job details">
                                          <IconButton size="small" onClick={(ev) => handleViewJob(ev, jobInfo)}
                                                      sx={{padding: '2px'}}>
                                              <Visibility sx={{fontSize: 14}} />
                                          </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Cancel job">
                                          <IconButton size="small" onClick={(ev) => handleCancelJob(ev, methodKey, firstPendingPredKey)}
                                                      sx={{padding: '2px', color: 'error.main'}}>
                                              <Cancel sx={{fontSize: 14}} />
                                          </IconButton>
                                      </Tooltip>
                                  </React.Fragment>
                                : undefined }
                          </React.Fragment>
                        : status ? <span style={{fontSize: '11px', color: '#666'}}>[{status}]</span> : undefined }
                </MenuItem>
            );
        });
    }

    return (
        <React.Fragment>
            <Button
                sx={{...style, backgroundColor: 'primary.blue', color: 'white'}}
                disabled={defaultPreds.length === 0 && Object.keys(groupPreds || {}).length === 0}
                onClick={onShow}
            >
                Structure Prediction
                { anyPending 
                  ? <React.Fragment>&nbsp;<CircularProgress size={12} /></React.Fragment>
                  : undefined }
                <ArrowDropDown/>
            </Button>
            <Menu
                id='structure-prediction-menu'
                open={isOpen}
                anchorEl={anchor}
                onClose={onClose}
                anchorOrigin={{vertical: 'bottom', horizontal: 'left'}}
                transformOrigin={{vertical: 'top', horizontal: 'left'}}
            >

                { predMenu(defaultPreds) }

                { Object.keys(groupPreds).map((g) => (
                    <div key={g} 
                         onMouseEnter={(ev) => {setGroupMenuAnchor(ev.currentTarget); setGroupOpen(g)}}
                         onMouseLeave={() => {setGroupOpen(undefined)}}>
                        <MenuItem style={{display: 'flex', justifyContent: 'space-between'}}>
                            {g}
                            <ArrowRight />
                        </MenuItem>
                        <Menu style={{pointerEvents: 'none'}}
                              slotProps={{paper: {sx: {pointerEvents: 'auto'}}}}
                              hideBackdrop
                              anchorEl={groupOpen ? groupMenuAnchor : undefined}
                              open={groupOpen === g}
                              onClose={() => setGroupOpen(undefined)}
                              anchorOrigin={{vertical: 'top', horizontal: 'right'}}
                              transformOrigin={{vertical: 'top', horizontal: 'left'}}>
                            { predMenu(groupPreds[g]) }
                        </Menu>
                    </div>

                )) }
            </Menu>
        </React.Fragment>
    )
}