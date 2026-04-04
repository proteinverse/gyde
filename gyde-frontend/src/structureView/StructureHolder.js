import React, {forwardRef, useState, useEffect} from 'react';
import memoize from 'memoize-one';

import {
    CircularProgress, Checkbox, FormControlLabel, Typography, Stack, Button, Dialog, DialogTitle, DialogContent,
    TextField, MenuItem
} from '@mui/material';

import {
    molstarSelectResiduesMulti, molstarClearSelection, labelClash,
    molstarApplyTheme, setModelIndex, lociForWholeChain, lociForWholeChainAuth,
    superposeLoci, deleteStructureByRef, getStructureRefFromLabel,
    applyDataTheme, molstarApplyDisorderTheme, molstarApplyChainTheme, setMolstarControlsVisibility,
    molstarRegisterSelectionListener, getAtomicMappings, getModelIndexFromLabel, cleanupThemes,
    atomicMappingsForModel, createMolStarPlugin, Plugin, applyDiffsTheme
} from './molstar';

import {SlivkaServiceContext, configMapToFormData} from '../czekolada/lib';
import {csvFormat} from 'd3-dsv';

import {getProteinOneLetterCode} from 'molstar/lib/mol-model/sequence/constants';

import { withResizeDetector } from 'react-resize-detector';
import { predictionKey, parseBoltzPLDDTs } from '../analysis/analysis';
import { readAsText } from '../utils/loaders';
import { average, max, min, normalizeArrayByMax, variance } from '../utils/math';
import { arrayCmp, pause } from '../utils/utils';
import { StructureNavBar } from './StructureNavBar';
import { nullToNegative } from '../gmsa/HeatmapUtils';
import { precomputeGaps, makeMappingsGeneric } from '../utils/structureUtils';
import { PingerContext } from '../Pinger';
import { TokenContext } from '../Token';
import { GydeWorkerServiceContext } from '../GydeWorkerService';
import { EnvironmentContext } from '../Environment';
import { StructurePredictDialog, NimPredictionDialog, usePredictionOptions } from './PredictDialogs';
import {
    extractAlignmments, extractSequences, extractLigands, structureInfoEqual , selectionCmp, parseStructureData,
    structureDataKey
} from './utils';
import {preUploadFiles} from '../utils/slivka-utils'


import {ALIGNMENT_STRUCTURE} from './reference';

const ERROR_LIMIT = 3;

const CONSTANT_EMPTY = [];

function updatePredictionsState(oldState, methodKey, predictionKey, status, pending) {
    const val = {};
    if (pending !== null) {
        val.predictionsPending = {
            ...oldState.predictionsPending,
            [methodKey]: {
                ...(oldState.predictionsPending[methodKey] || {}),
                [predictionKey]: pending
            }
        };
    }
    if (status !== null) {
        val.predictionsStatus = {
            ...oldState.predictionsStatus,
            [methodKey]: {
                ...(oldState.predictionsStatus[methodKey] || {}),
                [predictionKey]: status
            }
        };
    }

    return val;
}


class StructureHolder extends React.Component {
    currentlyLoading = new Set([]);
    currentlyFetching = new Set([]);
    currentlyPredicting = {};
    loading = false;
    structureInfos = [];

    constructor(props) {
        super(props);

        this.state = {
            structureError: null,

            predictionsPending: {},
            predictionsStatus: {},

            mappingMessage: null,

            structureLimit: 10,

            structureErrorCount: {},
            structureErrors: {},

            mappingCache: {},

            showingCzekoladaUI: undefined
        };

        this.onMolstarSelectionChange = this.onMolstarSelectionChange.bind(this);
        this.slivkaSubscriptions = [];
        this.hasBeenSuperposed = {};
    }

    align(seqA, seqB) {
        return this.props.gydeWorkerService.align(seqA, seqB, {substMatrix: 'blosum62'});
    }

    isBoltzEnabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).boltz;
    }

    isChaiEnabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).chai;
    }

    isBoltz1XEnabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).boltz1x;
    }

    isBoltz2Enabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).boltz2;
    }

    isChaiLabEnabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).chaiLab;
    }

    isOpenFold3Enabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).of3;
    }

    isOpenFold3V1Enabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).of3v1;
    }

    isIbexEnabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).ibex;
    }

    isNimPredictionEnabled() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).nimStructurePredictions;
    }

    useCollabServerMSAs() {
        const environment = this.props.environment;
        return (environment?.featureFlags || {}).collabServerMSAs;
    }

    selectionArray = memoize((selection) => {
        const a = Array.from(selection || []);
        a.sort((x, y) => x-y);
        return a;
    });

    componentDidMount() {
        this.viewerPromise = (async () => {
            const plugin  = await createMolStarPlugin();
            this.setState({plugin});
            // At this point, a re-render should create a Plugin React element.
            await plugin.canvas3dInitialized;
            const viewer = {plugin}
            this.molstartSelectionSubscription = molstarRegisterSelectionListener(viewer, this.onMolstarSelectionChange);
            return viewer;
        })();

        // Can we use the "methods array" to run these?
        this.runABodyBuilder(true, true); // Attempt to reconnect any previously-started jobs.
        this.runABodyBuilder2(true, true);
        this.runNBodyBuilder2(true, true); 
        this.runFullLengthPrediction(true, true);
        this.runFullLengthPrediction2024(true, true);
        this.runAlphafoldPrediction(true, true);

        if (this.isBoltzEnabled()) {
            this.runBoltzPrediction(true, true);
        }
        if (this.isBoltz1XEnabled()) {
            this.runBoltz1XPrediction(true, true);
        }
        if (this.isBoltz2Enabled()) {
            this.runBoltz2Prediction(true, true);
            this.runBoltz221Prediction(true, true);
        }
        if (this.isChaiEnabled()) {
            this.runChaiPrediction(true, true);
            this.runChaiMSAPrediction(true, true);
        }
        if (this.isChaiLabEnabled()) {
            this.runChaiLabPrediction(true);
            this.runChaiLabMSAPrediction(true);
        }
        if (this.isOpenFold3Enabled()) {
            this.runOF3Prediction(true);
        }
        if (this.isOpenFold3V1Enabled()) {
            this.runOF3V1Prediction(true);
            if (this.isNimPredictionEnabled()) {
                this.runOF3VNimPrediction(true);
            }
        }
        if (this.isIbexEnabled()) {
            this.runIbexPrediction(true);
            this.runABodyBuilder3Prediction(true);
        }
    }

    componentWillUnmount() {
        this.molstartSelectionSubscription?.unsubscribe();

        this.viewerPromise?.then((viewer) => {
            viewer.plugin.dispose();
        });

        for (const ss of this.slivkaSubscriptions) {
            // We should only get SlivkaSubscription objects in here, but useful to be robust in
            // case slivka returns a null for some reason.

            try {
                ss.unsubscribe();
            } catch (err) {}
        }
    }

    _getCnameIndex = memoize((cnames) => {
        const cnameIndex = {};
        cnames.forEach((n, i) => {if (n) cnameIndex[n] = i});
        return cnameIndex;
    })

    getRefStructureIndex(index) {
        const {columnarData, structureSequence} = this.props;

        const seeds = columnarData[this.props.refNameColumn] || CONSTANT_EMPTY;
        const cnames = columnarData[this.props.nameColumn] || CONSTANT_EMPTY;
        const cnameIndex = this._getCnameIndex(cnames);

        const hasReference = seeds[index] && typeof(cnameIndex[seeds[index]]) === 'number';
        if (hasReference && structureSequence === 'ref') index = cnameIndex[seeds[index]];

        return index;
    }

    extractStructuresFromSelection(
        columnarData, seqColumns, seqRefColumns, dsAlignments, dsReferences,
        selection, columnTypes, structureSequence, visibleStructures, isAntibody=false,
        mappingCache={}
    ) {
        if (selection === true && seqColumns?.length > 0) {
            selection = []
            for (let i = 0; i < columnarData[seqColumns[0].column].length; ++i) {
                selection.push(i);
            }
        } else  if (!selection || selection.size === 0) {
            return [];
        } else {
            selection = this.selectionArray(selection);
        }

        const rowids = columnarData._gyde_rowid;

        const ligandColumnKeys = Object.entries(columnTypes || {}).filter(([k, v]) => v === 'smiles').map(([k, v]) => k),
              ligandColumns = ligandColumnKeys.map((k) => columnarData[k]),
              dnaColumnKeys = Object.entries(columnTypes || {}).filter(([k, v]) => v === 'dna').map(([k, v]) => k),
              dnaColumns = dnaColumnKeys.map((k) => columnarData[k]),
              rnaColumnKeys = Object.entries(columnTypes || {}).filter(([k, v]) => v === 'rna').map(([k, v]) => k),
              rnaColumns = rnaColumnKeys.map((k) => columnarData[k]);

        function get(col, i) {
            return (columnarData[col] || [])[i];
        }
        
        const seeds = columnarData[this.props.refNameColumn] || [],
        cnames = columnarData[this.props.nameColumn] || [];
        const cnameIndex = {};
        cnames.forEach((n, i) => {if (n) cnameIndex[n] = i});
        
        const getStructureInfo = (index) => {
            const result = [];
            const selectedIndex = index;
            const hasReference = seeds[index] && typeof(cnameIndex[seeds[index]]) === 'number';
            
            if (structureSequence === 'ref') {
                if (hasReference) {
                    index = cnameIndex[seeds[index]];
                }
            }

            const availStructureKeys = this.getAvailStructureKeys();
            const overlap = availStructureKeys.filter((k) => visibleStructures.includes(k));
            const structureKeys = (overlap.length === 0) ? availStructureKeys.slice(0, 1) : overlap;

            // We need to make sure there is *something* here, otherwise de novo predictions on non-antibodies cannote
            // be run.
            if (!structureKeys.length) {
                structureKeys.push('predicted_structure');
            }

            for (const structureKey of structureKeys) {
                const sequences = extractSequences(index, seqColumns, seqRefColumns, columnarData),
                      proteinSequences = sequences.filter((s, i) => (columnTypes[seqColumns[i].column] ?? 'protein') === 'protein'),
                      alignments = extractAlignmments(index, seqColumns, dsAlignments, dsReferences),
                      ligands = extractLigands(index, ligandColumns),
                      dnas = extractLigands(index, dnaColumns),
                      rnas = extractLigands(index, rnaColumns),
                      dataOrURL = get(structureKey, index),
                      rowName = columnarData[this.props.nameColumn] ? get(this.props.nameColumn, index) : get('name', index),
                      status = dataOrURL?._gyde_analysis,
                      url = (dataOrURL?._gyde_analysis && (!dataOrURL instanceof Blob)) ? dataOrURL?._gyde_url : dataOrURL,
                      method = dataOrURL?._gyde_analysis ? dataOrURL?._gyde_method : dataOrURL?.gyde_source,
                      explicitChains = dataOrURL?._gyde_chains || (structureKey === 'structure_url' ? get('structure_chains', index) : undefined),
                      explicitMappings = (structureKey === 'structure_url' ? get('structure_residue_numbering', index) : undefined),
                      modelIndex = (structureKey === 'structure_url' && typeof(get('_structure_index', index) === 'number'))
                          ? get('_structure_index', index)
                          : undefined;
    
                let chains = explicitChains;
    
                if (!chains && structureKey === 'moe_full_length_fab') {
                    // FIXME
                    // Until we have a place in the data model for per-structure chain mappings,
                    // we need to special-case MOE Fabs where which use "A,B" instead of "L,H"
                    chains = seqColumns.map(({column}) => {
                        if (column === this.props.hcColumn) {
                            return 'B';
                        } else if (column === this.props.lcColumn) {
                            return 'A';
                        }
                    });
                }

                let hc, lc;
    
                if (this.props.isAntibody) {
                    const hcIndex = seqColumns.findIndex(({column}) => column === this.props.hcColumn),
                          lcIndex = seqColumns.findIndex(({column}) => column === this.props.lcColumn);
                    if (hcIndex >= 0) hc = sequences[hcIndex];
                    if (lcIndex >= 0) lc = sequences[lcIndex];
                }
    
                const thisPredictionKey = 
                    (hc && lc ? predictionKey(hc, lc) : proteinSequences.join('-') + 
                    (ligands ? ('_' + ligands.join('_')) : '')) + 
                    (dnas ? ('_' + dnas.map((d) => 'd' + d).join('_')) : '') + 
                    (rnas ? ('_' + rnas.map((d) => 'r' + d).join('_')) : '');

                result.push({
                    sequences, alignments, proteinSequences, ligands, dnas, rnas,
                    url, explicitChains: chains, explicitMappings, modelIndex, hc, lc,
                    predictionKey: thisPredictionKey,
                    method,
                    groupingKey: structureDataKey(url) || thisPredictionKey,
                    dataIndices: new Set([index]),
                    selectedIndices: new Set([selectedIndex]),
                    hasReference, structureKey, status, rowName,
                    plddts: dataOrURL?._gyde_plddts,
                    type: dataOrURL?._gyde_type
                });
            }

            return result;
        }

        const structuresByKey = {};

      RECORD_LOOP:
        for (const index of selection) {
            const structureInfo = getStructureInfo(index);
            for (const si of structureInfo) {
                const key = si.groupingKey;
                if (structuresByKey[key]) {
                    for (let osi = 0; osi < structuresByKey[key].length; ++osi) {
                        if (structureInfoEqual(si, structuresByKey[key][osi])) {
                            for (const i of si.dataIndices) structuresByKey[key][osi].dataIndices.add(i);
                            for (const i of si.selectedIndices) structuresByKey[key][osi].selectedIndices.add(i);
                            continue RECORD_LOOP;
                        }  
                    }
                } else {
                    structuresByKey[key] = [];
                }
                structuresByKey[key].push(si);
            }
        }

        const results = [];
        for (const sia of Object.values(structuresByKey)) {
            const taken = [];
            for (const si of sia) {
                if (si.url || si.structureKey === 'predicted_structure') {
                    taken.push(si)
                }
            }
            if (!taken.length) {
                // We want one example for prediction purposes
                const si = sia[0];
                if (si) taken.push(si);
            }


            for (const si of taken) {
                const dataIndices = Array.from(si.dataIndices);
                dataIndices.sort((a, b) => a-b);
                const selectedIndices = Array.from(si.selectedIndices);
                selectedIndices.sort((a, b) => a-b);
                const structureLabel = si.structureKey ? (si.structureKey + '_' + rowids[dataIndices[0]]) : undefined;
                results.push({
                    ...si, 
                    dataIndices,
                    selectedIndices,
                    structureLabel,
                    explicitChains: si.explicitChains ?? (structureLabel && mappingCache[structureLabel]?.chains),
                    explicitMappings: si.explicitMappings ?? (structureLabel && mappingCache[structureLabel]?.mappings)
                });
            }
        }

        return results;
    }

    async toggleStructureVisibility(key) {
        const {visibleStructures, setVisibleStructures} = this.props;

        const newVisibleStructures = [...visibleStructures];
        const ind = newVisibleStructures.indexOf(key);

        if (ind >= 0) {
            newVisibleStructures.splice(ind, 1);
        } else {
            newVisibleStructures.push(key);
        }

        setVisibleStructures(newVisibleStructures);
    }

    async componentDidUpdate(oldProps, oldState) {
        const {
            selection, columnarData, seqColumns, alignments, references, seqRefColumns,
            structureSequence, visibleStructures, setVisibleStructures, structureColorScheme, 
            colormap, isHeatmapVisible, isAntibody, setStructureColorScheme, heatmapData,
            columnTypes
        } = this.props;

        const viewer = await this.viewerPromise;
        
        if (!!alignments && !!references) {
            this.structureInfos = this.extractStructuresFromSelection(
                columnarData, seqColumns, seqRefColumns, alignments, references, 
                selection, columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
            );
        }

        if (this.state.loading) return;

        if (selection !== oldProps.selection && isAntibody) {
            const availStructureKeys = this.getAvailStructureKeys();
            const overlap = availStructureKeys.filter((k) => visibleStructures.includes(k));
            if (overlap.length === 0 && availStructureKeys.length > 0) setVisibleStructures(availStructureKeys.slice(0, 1));

            for (const index of selection || []) {
                const availStructureKeysForIndex = this.getAvailStructureKeysForIndex(index);
                
                if (!availStructureKeysForIndex.includes('abodybuilder2')) {
                    this.runABodyBuilder2(true);
                }
                if (!availStructureKeysForIndex.includes('moe_full_length_fab')) {
                    this.runFullLengthPrediction(true);
                }
            }
        }

        const currModels = viewer.plugin.managers.structure.hierarchy.state.hierarchy.models;

        // find what models need to be loaded into the viewer
        const structuresInMolstar = currModels.map((model) => model.cell.obj.data.label)
        const structuresFromGYDE = this.structureInfos.filter(
            (si) => (si.url && visibleStructures.includes(si.structureKey))).map(
            (si) => si.structureLabel
        )

        const modelsToLoad = structuresFromGYDE
            .filter((v) => !structuresInMolstar.includes(v))
            .filter((v) => (this.state.structureErrorCount[v] || 0) < ERROR_LIMIT);

        // find what models need to be unloaded from the viewer
        const modelsToUnload = structuresInMolstar.filter((v) => !structuresFromGYDE.includes(v));

        const structuresInMolstarCounts = structuresInMolstar.reduce((prev, curr) => {
            (!prev[curr]) ? prev[curr] = 1 : prev[curr] += 1;
            return prev;
        }, {});
        for (const [key, val] of Object.entries(structuresInMolstarCounts)) {
            for (let i = 1; i < val; i++) {
                modelsToUnload.push(key);
            }
        }

        let didLoadModels = false;
        if (structuresFromGYDE.length <= this.state.structureLimit) {
            for (const structureInfo of this.structureInfos) {
                const {structureKey, modelIndex, url, sequences, dataIndices, status, structureLabel} = structureInfo;
                const index = this.getRefStructureIndex(dataIndices[0]);
                
                if (modelsToLoad.includes(structureLabel) && !this.currentlyLoading.has(structureLabel)) {
                    const didLoad = await this.loadStructure(viewer, url, structureKey, index, structureLabel, structureInfo);
                    didLoadModels ||= didLoad;
                }
            }
        }

        // by the time this block gets called, this.loadStructure will have already loaded the last remaining structure
        if (didLoadModels) {
            setTimeout(() => {
                this.updateStructureColoring(viewer);
                this.updateStructureSelection(viewer);
            }, 300)
        }

        for (const label of modelsToUnload) {
            if (!(label === 'alignment_structure')) {
                await this.deleteStructureByLabel(label);
            }
        }

        /// update coloring
        if (isHeatmapVisible !== oldProps.isHeatmapVisible) {
            if (!isHeatmapVisible) {
                if (isAntibody) {
                    setStructureColorScheme('CDRs');
                } else {
                    setStructureColorScheme('chain');
                }
            }
        }

        if (
            colormap !== oldProps.colormap ||
            structureColorScheme !== oldProps.structureColorScheme ||
            heatmapData !== oldProps.heatmapData ||
            this.state.mappingCache !== oldState.mappingCache
        ) {
            const viewer = await this.viewerPromise;
            setTimeout(() => {
                this.updateStructureColoring(viewer);
            }, 100)
        }

        if (this.props.references !== oldProps.references ||
            this.props.alignments !== oldProps.alignments ||
            this.props.selection !== oldProps.selection ||
            !selectionCmp(this.props.selectedColumns || [], oldProps.selectedColumns || []) ||
            this.state.mappingCache !== oldState.mappingCache
        ) {
            const viewer = await this.viewerPromise;
            this.updateStructureSelection(viewer);
        }

        // change viewer settings with widget layout
        if (this.props.compact !== oldProps.compact) {
            if (this.viewerPromise) {
                const viewer = await this.viewerPromise;
                setMolstarControlsVisibility(viewer, !this.props.compact)
            }
        }

        if (this.props.autoSuperpose) {
            const viewer = await this.viewerPromise;
            await this.doSuperpose(viewer);
        } else if (oldProps.autoSuperpose) {
            this.hasBeenSuperposed = {};
        }
    }

    updateStructureColoring(viewer) {
        const { structureColorScheme } = this.props;

        if (structureColorScheme.includes("heatmap")) {
            this.colorByData(viewer);
        } else if (structureColorScheme === "CDRs") { 
            this.colorCDRs(viewer);
        } else if (structureColorScheme === 'pLDDT') {
            this.colorPLDDT(viewer);
        } else if (structureColorScheme === 'Diffs to reference') {
            this.colorDiffs(viewer);
        } else /* if (structureColorScheme === 'chain') */ {
            molstarApplyChainTheme(viewer);
        }
    }

    async updateStructureSelection(viewer) {
        if (this.updatingSelection) return;
        try {
            // console.log('*** starting selection update');
            this.updatingSelection = true;
            const {
                selection, alignments, alignmentFeatures, references
            } = this.props;

            molstarClearSelection(viewer);

            const highlightChains = [];
            for (const structureInfo of this.structureInfos) {
                const {sequences, explicitChains, explicitMappings, structureLabel, dataIndices} = structureInfo;
                if (!explicitMappings) continue;
                const {chains, defaultStyles} = this.findChainsAndStyles(explicitChains, sequences);
                
                
                for (let i = 0; i < sequences.length; ++i) {
                    if (chains[i]) {
                        highlightChains.push({
                            structureLabel,
                            chains: chains[i],
                            features: (alignmentFeatures||[])[i],
                            aligned: (alignments[i] || []).filter((_, j) => selection.has(j)),
                            reference: (references[i] || []).filter((_, j) => selection.has(j)),
                            mapping: explicitMappings 
                                ? explicitMappings[i] 
                                : undefined,
                            defaultStyle: defaultStyles[i],
                            selectedColumns: (this.props.selectedColumns || [])[i] || new Set(),
                            dataIndices: dataIndices,  // Pass the row indices that own this structure
                            alignmentColumnIndex: i     // Track which sequence column this is
                        });
                    }
                }
            }

            //if (structureSelectByMode === 'link') {
                this.setStructureHighlightsByLink(viewer, highlightChains);
            //} else {
            //    this.setStructureHighlightsByDiff(viewer, highlightChains);
            //}
        } finally {
            // console.log('***ending structure selection')
            this.updatingSelection = false;
        }
    }

    getAvailStructureKeysForIndex(index) {
        const {columnarData, structureKeys} = this.props;
        
        const structureIndex = this.getRefStructureIndex(index);

        return structureKeys.filter((k) => (
            !!columnarData[k] && 
            !!columnarData[k][structureIndex] && 
            columnarData[k][structureIndex]?._gyde_analysis !== 'pending' &&
            columnarData[k][structureIndex]?._gyde_analysis !== 'error'
        ));
    }

    getAvailStructureKeys() {
        const {columnarData, structureKeys, selection, structureSequence} = this.props;
        if (!selection) return [];
        const seeds = columnarData[this.props.refNameColumn] || CONSTANT_EMPTY;
        const cnames = columnarData[this.props.nameColumn] || CONSTANT_EMPTY;
        const cnameIndex = structureSequence === 'ref' ? this._getCnameIndex(cnames) : {};

        const selectionArray = Array.from(selection);

        const refStructures = structureSequence === 'ref' ? new Set(selectionArray.map((index) => {
            if (seeds[index] && typeof(cnameIndex[seeds[index]]) === 'number') {
                return cnameIndex[seeds[index]];
            }

            return index;
        })) : selectionArray;

        return structureKeys.filter((key) => {
            for (const structureIndex of refStructures) {
                if (!!columnarData[key] && 
                    !!columnarData[key][structureIndex] && 
                    columnarData[key][structureIndex]?._gyde_analysis !== 'pending' &&
                    columnarData[key][structureIndex]?._gyde_analysis !== 'error') 
                {
                    return true;
                }
            }
            return false;
        });
    }

    findChainsAndStyles(explicitChains, sequences) {
        const {seqColumns, hcColumn, lcColumn, isAntibody} = this.props;
        const chains = explicitChains ? [...explicitChains] : sequences.map((s) => undefined);
        const defaultStyles = chains.map((c) => undefined);

        if (isAntibody) {
            const hcIndex = seqColumns.findIndex(({column}) => column === hcColumn),
            lcIndex = seqColumns.findIndex(({column}) => column === lcColumn);
            
            if (hcIndex >= 0) {
                if (!explicitChains) chains[hcIndex] = chains[hcIndex] || 'H';
                defaultStyles[hcIndex] = 'framework_heavy';
            }
            if (lcIndex >= 0) {
                if (!explicitChains) chains[lcIndex] ||= 'L';
                defaultStyles[lcIndex] = 'framework_light';
            }
        }

        return {chains, defaultStyles};
    }

    colorCDRs(svp) {
        const { selection } = this.props;

        if (this.structureInfos.length > 0) {
            if (svp) {
                (svp instanceof Promise ? svp : Promise.resolve(svp)).then((viewer) => {
                    cleanupThemes(viewer);
                    for (const structureInfo of this.structureInfos) {
                        const {sequences, explicitChains, explicitMappings, structureLabel} = structureInfo;
                        if (!explicitMappings) continue;
                        const {chains, defaultStyles} = this.findChainsAndStyles(explicitChains, sequences);

                        const highlightChains = [];
                        for (let i = 0; i < sequences.length; ++i) {
                            if (chains[i]) {
                                highlightChains.push({
                                    chains: chains[i],
                                    features: (this.props.alignmentFeatures||[])[i],
                                    aligned: (this.props.alignments[i] || []).filter((_, j) => selection.has(j)),
                                    reference: (this.props.references[i] || []).filter((_, j) => selection.has(j)),
                                    mapping: explicitMappings 
                                        ? explicitMappings[i] 
                                        : undefined,
                                    defaultStyle: defaultStyles[i],
                                });
                            }
                        }

                        if (highlightChains.length) {
                            if (this.props.isAntibody) {
                                // Should this also apply to non-antibody now?
                                molstarApplyTheme(viewer, highlightChains, structureLabel);
                            }
                        }
                    }
                });
            }
        }
    }

    useDisorderAsPLDDT(structureKey, method) {
        return (
            structureKey.startsWith('alphafold_') || 
            structureKey.startsWith('chai_') || 
            structureKey.startsWith('boltz1X_') || 
            structureKey.startsWith('of3_')  || 
            structureKey.startsWith('of3v1_') || 
            (method === 'Alphafold') ||
            (method === 'chai-lab-0.6.1') ||
            (method === 'chai-lab-collabfold-msa-0.6.1') ||
            (method === 'Chai-1') ||
            (method === 'Chai-1+MSA') ||
            (method === 'OpenFold-3') ||
            (method === 'OpenFold-3 v1')
        );
    }

    async colorPLDDT(svp) {
        if (this.structureInfos.length > 0) {
            if (svp) {
                (svp instanceof Promise ? svp : Promise.resolve(svp)).then( async (viewer) => {
                    for (const {explicitChains, sequences, structureKey, structureLabel, url, plddts, dataIndices, method} of this.structureInfos) {
                        const {chains} = this.findChainsAndStyles(explicitChains, sequences);

                        if (this.useDisorderAsPLDDT(structureKey, method)) {
                            await molstarApplyDisorderTheme(viewer, structureLabel);
                        } else if (plddts) {
                            const colorData = this.props.seqColumns.map((item, index) => {
                                const sequence = sequences[index];

                                const numbering = [];
                                for (let i = 1; i <= sequence.length; ++i) {
                                    numbering.push('' + i);
                                }

                                return {
                                    values: plddts[index],
                                    gaps: [],
                                    numbering: numbering,
                                    sequence: sequence
                                }
                            });

                            await applyDataTheme(
                                viewer, colorData, chains, 'pLDDT', structureLabel, dataIndices[0], 'plddt', 'structureKey'
                            );
                        } 
                    }           
                });
            }
        }
    }

    async colorByData(viewer) {
        const { alignments, heatmapData, colormap, structureColorScheme, heatmapColumn } = this.props;

        if (this.structureInfos.length === 0) return;
        
        cleanupThemes(viewer);
        for (const structureInfo of this.structureInfos) {
            // get chains
            const {explicitChains, explicitMappings, sequences, dataIndices, structureLabel} = structureInfo;
            const {chains} = this.findChainsAndStyles(explicitChains, sequences);
    
            let data = [];
            this.props.seqColumns.forEach((item, index) => {
                const sequenceAlignment = alignments[index][dataIndices[0]];
                const numbering = alignments[index].residueNumbers;
    
                const nvm = heatmapData[item.column].normalized_value_matrix;
    
                const seqData = [];
                const gapData = [];
    
                for (let i = 0; i < nvm.length; i++) {
                    if (sequenceAlignment[i] !== '-' /* && sequenceAlignment[i] !== 'X' */) {
                        gapData.push(0)
                    } else {
                        gapData.push(1)
                    }
    
                    if (structureColorScheme.includes("average")) {
                        seqData.push(average(nvm[i]));
                    }
                    else if (structureColorScheme.includes("variance")) {
                        seqData.push(variance(nvm[i]));
                    }
                    else if (structureColorScheme.includes("max")) {
                        seqData.push(max(nvm[i]));
                    }
                    else if (structureColorScheme.includes("min")) {
                        seqData.push(min(nvm[i]));
                    }
                }
    
                data.push({
                    values: nullToNegative(normalizeArrayByMax(seqData)),
                    gaps: precomputeGaps(gapData),
                    numbering: numbering,
                    sequence: sequenceAlignment
                });
            });
    
            const metric = structureColorScheme.substring(7);

            await applyDataTheme(
                viewer, data, chains, colormap, structureLabel, dataIndices[0], metric, heatmapColumn, explicitMappings
            );
        }
    }

    async colorDiffs(viewer) {
        const { alignments, references } = this.props;

        if (this.structureInfos.length === 0) return;
        
        cleanupThemes(viewer);
        const highlightPosn = {};
        for (const structureInfo of this.structureInfos) {
            // get chains
            const {explicitChains, explicitMappings, sequences, dataIndices, structureLabel} = structureInfo;

            const {chains} = this.findChainsAndStyles(explicitChains, sequences);
    
            const seenPosns = {};
            const failedPosns = [];

            this.props.seqColumns.forEach((item, index) => {
                for (const di of dataIndices) {
                    const seq = alignments && alignments[index] && alignments[index][di], base = references && references[index] && references[index][di];
                    if (!seq || !base) continue;

                    for (let i = 0, j=0; i < Math.min(seq.length, base.length); ++i) {
                        if (seq[i] === '-') continue;

                        if (seq[i] !== base[i]) {
                            const key = chains[index] + '_' + j;
                            if (seenPosns[key]) {
                                // Ignore
                            } else {
                                for (const chain of chains[index].split(',')) {
                                    // TODO: mappings is undefined sometimes
                                    const mapping = explicitMappings && explicitMappings[index];
                                    if (!mapping) continue;

                                    const mappingItem = mapping[j];
                                    if (mappingItem?.value?.residueNumber) {
                                        if (!highlightPosn[structureLabel]) highlightPosn[structureLabel] = [];
                                        highlightPosn[structureLabel].push([chain, mappingItem.value.residueNumber]);
                                    } else {
                                        failedPosns.push(j);
                                    }
                                }
                            }
                            seenPosns[key] = true;
                        }
                        ++j;
                    }
                }
            });
        }

        await applyDiffsTheme(
            viewer, highlightPosn
        );
    }

    async setStructureHighlightsByLink(viewer, chainRecords) {
        const mappings = getAtomicMappings(viewer);
        const {alignments, selection} = this.props;

        const highlightPosn = {};
        const failedPosns = [];

        for (const {structureLabel} of chainRecords) {
            highlightPosn[structureLabel] = [];
        }

        for (const {structureLabel, aligned: seqs, chains, mapping: explicitMapping, selectedColumns, dataIndices, alignmentColumnIndex} of chainRecords) {
            // Fix: Use the structure owner's sequence instead of just seqs[0]
            // Get the sequence from the alignment for the row that owns this structure
            let seq;
            if (dataIndices && alignments && alignmentColumnIndex !== undefined && selection) {
                const ownerRowIdx = dataIndices[0];
                if (!selection.has(ownerRowIdx)) continue;  // Skip if owner row not selected
                const columnAlignments = alignments[alignmentColumnIndex];
                seq = columnAlignments ? columnAlignments[ownerRowIdx] : seqs[0];
            } else {
                // Fallback to original behavior
                seq = seqs[0];
            }
            
            if (!seq) continue;

            for (const chain of chains.split(',')) {
                const mapping = explicitMapping || (mappings[structureLabel] || {})[chain];
                if (!mapping) continue;

                const gappedMapping = new Array(seq.length);
                for (let i = 0, j = 0; i < seq.length; ++i) {
                    if (seq[i] === '-') {
                        continue;
                    } else {
                        gappedMapping[i] = mapping[j++]?.value?.residueNumber;
                    }
                }

                for (const i of selectedColumns) {
                    if (gappedMapping[i]) {
                        highlightPosn[structureLabel].push([chain, gappedMapping[i]]);
                    }
                }
            }
        }

        this.setState({
            mappingMessage: failedPosns.length > 0 ? `Could not map positions ${failedPosns.join(',')} for highlighting` : undefined,
            highlightSeqids: this.selectionArray(this.props.selection).map((s) => s.toString()).join(';')
        });

        molstarSelectResiduesMulti(viewer, highlightPosn, false);
    }

    async loadAlignmentStructure(viewer, structureKey) {
        const {columnarData, isAntibody, soloSelection} = this.props;
        if (!isAntibody) return;

        const alreadyLoaded = labelClash(viewer, 'alignment_structure');

        if (!alreadyLoaded) {
            //The below is equivalent to loadStructureFromData in Viewer, but doing it ourselves 
            // improves error-handling options and allows us to specify the representation (empty, in this case)
            const _data = await viewer.plugin.builders.data.rawData({ data: ALIGNMENT_STRUCTURE, label: 'alignment_structure' });
            const trajectory = await viewer.plugin.builders.structure.parseTrajectory(_data, 'pdb');
            if (!trajectory) {
                throw Error('Structure parsing failed, check file format');
            }
            await viewer.plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', {representationPreset: 'empty'});
        }
        
        return ALIGNMENT_STRUCTURE;
    }

    async doSuperpose(viewer) {
        const infoByLabel = {};
        for (const si of this.structureInfos || []) {
            infoByLabel[si.structureLabel] = si;
        }

        const models = viewer.plugin.managers.structure.hierarchy.state.hierarchy.models;

        const targets = [];
        const alignmentStructureIndex = getModelIndexFromLabel(viewer, 'alignment_structure') ?? 0;

        for (let i = 0; i < models.length; ++i) {
            const label =  models[i].cell.obj.data.label;
            if (i !== alignmentStructureIndex && !this.hasBeenSuperposed[label]) {
                targets.push(i);
            }
        }
        if (targets.length === 0) {
            return;
        }

        const refLabel = models[alignmentStructureIndex].cell.obj.data.label,
              refInfo = refLabel === 'alignment_structure' ? {explicitChains: ['H', 'L']} : infoByLabel[refLabel];

        if (!refInfo) {
            console.log('*** Bad superpose reference', refLabel);
            return;
        }

        for (const target of targets) {
            const model = models[target],
                  label = model.cell.obj.data.label,
                  info = infoByLabel[label];

            if (!info) {
                console.log('*** Unexpected structure', label);
                continue;
            }


            if (this.props.seqColumns?.length) {
                await this._doSuperposePairMapped(viewer, target, model, label, refLabel, infoByLabel[label], refInfo, alignmentStructureIndex);
            } else {
                await this._doSuperposePairFree(viewer, target, model, models[alignmentStructureIndex], label, refLabel, alignmentStructureIndex);
            }
        }
    }

    async _doSuperposePairMapped(viewer, target, model, label, refLabel, info, refInfo, alignmentStructureIndex) {
        const chains = info.explicitChains,
              refChains = refInfo.explicitChains;

        if (!chains) {
            console.log('No chain mapping for ', label);
            return;
        }
        if (!refChains) {
            console.log('No chain mapping for ', refLabel);
            return;
        }

        let superColumn = -1;
        for (let i = 0; i < chains.length; ++i) {
            if (chains[i] && refChains[i]) {
                superColumn = i;
                break;
            }
        }

        if (superColumn < 0) {
            console.log('No common chain to superpose');
            return;
        }

        const refLoci = lociForWholeChainAuth(viewer, alignmentStructureIndex, refChains[superColumn].split(',')[0]);
        const targetLoci = lociForWholeChainAuth(viewer, target, chains[superColumn].split(',')[0]);

        await superposeLoci(viewer, [refLoci, targetLoci]);
        this.hasBeenSuperposed[label] = true;
    }

    async _doSuperposePairFree(viewer, target, model, refModel, label, refLabel, alignmentStructureIndex) {
        const mappings = await this._makeFreeMappings(refModel, model)
        const flatMappings = mappings.flatMap((m) => m);
        flatMappings.sort((fm, gm) => gm.alignment.score - fm.alignment.score);

        if (flatMappings.length > 0) {
            const mapping = flatMappings[0];
            const refLoci = lociForWholeChainAuth(viewer, alignmentStructureIndex, mapping.refChains[0]);
            const targetLoci = lociForWholeChainAuth(viewer, target, mapping.chain);

            await superposeLoci(viewer, [refLoci, targetLoci]);
            this.hasBeenSuperposed[label] = true;
        }
    }

    async _makeFreeMappings(model1, model2) {
        const realModel1 = model1.cell.obj.data, 
              realModel2 = model2.cell.obj.data;

        const atomics1 = atomicMappingsForModel(realModel1);
        const seqByChain1 = {},
              numbersByChain1 = {};
        for (const [chain, residues] of Object.entries(atomics1)) {
            const seq = residues.map((r) => getProteinOneLetterCode(r.value.residue)).join('');
            seqByChain1[chain] = seq;
            numbersByChain1[chain] = residues.map((r) => r.value);
        }

        const atomics2 = atomicMappingsForModel(realModel2);
        const seqByChain2 = {},
              numbersByChain2 = {};
        for (const [chain, residues] of Object.entries(atomics2)) {
            const seq = residues.map((r) => getProteinOneLetterCode(r.value.residue)).join('');
            seqByChain2[chain] = seq;
            numbersByChain2[chain] = residues.map((r) => r.value);
        }

        const chainBySeq1 = {};
        for (const [chain, seq] of Object.entries(seqByChain1)) {
            if (!chainBySeq1[seq]) chainBySeq1[seq] = [];
            chainBySeq1[seq].push(chain);
        }

        const chainBySeq2 = {};
        for (const [chain, seq] of Object.entries(seqByChain2)) {
            if (!chainBySeq2[seq]) chainBySeq2[seq] = [];
            chainBySeq2[seq].push(chain);
        }

        const entries1 = Object.entries(chainBySeq1),
              entries2 = Object.entries(chainBySeq2);
        const chainMappingAlignments = entries1.map((_) => []);
        await Promise.all(
            entries2.map(async ([ss, chains]) => {
                let bestAli = {score: -1000}, bestIndex = null;

                entries1.forEach(([rs, _], rsi) => {
                    if (rs === ss) {
                        if (bestIndex === null) {
                            bestAli = {
                                score: rs.length * 100,
                                aliA: ss,
                                aliB: rs
                            };
                            bestIndex = rsi;
                        }
                    }
                });

                if (bestIndex === null) {
                    await Promise.all(
                        entries1.map(async ([rs, _], rsi) => {
                            const ali = await this.props.gydeWorkerService.align(ss, rs);
                            if (ali.score > bestAli.score || (ali.score === bestAli.score && rsi < bestIndex)) {
                                bestAli = ali;
                                bestIndex = rsi;
                            }
                        })
                    );
                } 

                if (bestAli.aliA) {
                    for (const auth of chains || []) {
                        chainMappingAlignments[bestIndex].push({refChains: entries1[bestIndex][1], chain: auth, alignment: bestAli});
                    }
                }
            })

        );
        return chainMappingAlignments;
    }

    async loadStructure(viewer, structureData, structureKey, index, structureLabel, structureInfo) {
        if (this.currentlyLoading.size > 0) return false;

        try {
            const structureIndex = this.getRefStructureIndex(index);
            
            // do not add a new structure if there is one already existing with the same key
            if (labelClash(viewer, structureLabel)) return;
            
            this.currentlyLoading.add(structureLabel);
            
            // load the reference structure for alignment if there is one
            const alignmentStructureData = this.props.autoSuperpose ? await this.loadAlignmentStructure(viewer, structureKey) : undefined;

            // load the structure to be added
            const {structureText, format} = await parseStructureData(structureData, (progress) => this.setState({structureProgress: progress}));

            // The below is equivalent to loadStructureFromData in Viewer.  However, we have to do
            // this ourselves in order to catch the case where parsing failed (which is signalled by
            // a falsey value from parseTrajectory)
            const _data = await viewer.plugin.builders.data.rawData({ data: structureText, label: structureLabel });
            const trajectory = await viewer.plugin.builders.structure.parseTrajectory(_data, format);
            if (!trajectory) {
                throw Error('Structure parsing failed, check file format');
            }
            await viewer.plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
            await pause(50);  // Still seeing some cases where models don't appear to exist at this point (?)
            const models = viewer.plugin.managers.structure.hierarchy.state.hierarchy.models;
            let model = models.at(-1);
            model.cell.obj.data.label = structureLabel;

            if (structureIndex !== null && structureIndex !== undefined) {
                await setModelIndex(viewer, structureLabel, structureIndex);
                const models = viewer.plugin.managers.structure.hierarchy.state.hierarchy.models;
                model = models.at(-1);
                model.cell.obj.data.label = structureLabel;
            }

            this.hasBeenSuperposed[structureLabel] = false;
            this.setState((oldState) => ({
                structureError: null,
                structureErrors: {
                    ...oldState.structureErrors,
                    [structureLabel]: undefined
                },
                structureErrorCount: {
                    ...oldState.structureErrorCount,
                    [structureLabel]: undefined
                },
            }));

            // Mapping generation can run in the background.  Superposition with be triggered from componentDidUpdate
            // once these are available.
            if ((!structureInfo.explicitChains || !structureInfo.explicitMappings) && !this.state.mappingCache[structureLabel]) {
                const realModel = model.cell.obj.data;
                this.makeMappings(realModel, structureInfo, structureInfo.explicitChains);
            }

            return true;
        } catch (err) {
            this.setState((oldState) => ({
                structureProgress: undefined,
                structureErrorCount: {
                    ...oldState.structureErrorCount,
                    [structureLabel]: (oldState.structureErrorCount[structureLabel] || 0) + 1
                },
                structureErrors: {
                    ...oldState.structureErrors,
                    [structureLabel]: err?.message || err || 'unknown error'
                },
                structureError: err?.message || err
            }));
            console.log(err);
        } finally {
            this.currentlyLoading.clear();
        }
    }

    async makeMappings(realModel, structureInfo, explicitChains) {
        const entities = realModel.sequence.sequences.map((seq) => seq.entityId);
        const structSeqs = realModel.sequence.sequences.map((seq) => seq.sequence.code.toArray().join(''));

        const atomics = atomicMappingsForModel(realModel);
        const seqByChain = {},
              numbersByChain = {};
        for (const [chain, residues] of Object.entries(atomics)) {
            const seq = residues.map((r) => getProteinOneLetterCode(r.value.residue)).join('');
            seqByChain[chain] = seq;
            numbersByChain[chain] = residues.map((r) => r.value);
        }


        const {chains, mappings} = await makeMappingsGeneric(
            this.props.gydeWorkerService,
            seqByChain,
            numbersByChain,
            structureInfo.sequences,
            explicitChains
        );

        this.setState((oldState) => ({
            mappingCache: {
                ...oldState.mappingCache,
                [structureInfo.structureLabel]: {
                    chains: chains,
                    mappings: mappings,
                }
            }
        }));
    }

    async deleteStructureByLabel(label) {
        const viewer = await this.viewerPromise;
        const referenceStructureRef = getStructureRefFromLabel(viewer, label);
        await deleteStructureByRef(viewer, referenceStructureRef);
    }

    getVal = (col) => {
        const {columnarData, selection, soloSelection} = this.props;
        if (!selection || !selection.size) return;
        return (columnarData[col] || [])[soloSelection];
    }

    getPredictionMethods() {
        return this.getPredictionMethodsImpl(this.props.environment);
    }

    getPredictionMethodsImpl = memoize((env) => {
        return ([
            {
                name: 'Alphafold 2',
                callback: this.runAlphafoldPrediction,
                key: 'af2',
                enabled: true,
                gateOnService: 'af2',
                group: 'AlphaFold'
            },
            {
                name: 'Boltz-1',
                callback: this.runBoltzPrediction,
                key: 'boltz',
                enabled: this.isBoltzEnabled(),
                gateOnService: 'boltz-1',
                group: 'Boltz'
            },
            {
                name: 'Boltz-1x',
                callback: this.runBoltz1XPrediction,
                key: 'boltz1X',
                enabled: this.isBoltz1XEnabled(),
                available: 'molecules',
                gateOnService: 'boltz-1x',
                group: 'Boltz'
            },
            {
                name: 'Boltz-2.0.3',
                callback: this.runBoltz2Prediction,
                key: 'boltz2',
                enabled: this.isBoltz2Enabled(),
                available: 'molecules',
                gateOnService: 'boltz-2',
                group: 'Boltz'
            },
            {
                name: 'Boltz-2.2.1',
                callback: this.runBoltz221Prediction,
                key: 'boltz221',
                enabled: this.isBoltz2Enabled(),
                available: 'molecules',
                gateOnService: 'boltz-2.2.1',
                group: 'Boltz'
            },
            {
                name: 'Chai-1 OLD',
                callback: this.runChaiPrediction,
                key: 'chai',
                enabled: this.isChaiEnabled(),
                gateOnService: 'chai-1',
                group: 'Chai'
            },
            {
                name: 'Chai-1 OLD+MSA',
                callback: this.runChaiMSAPrediction,
                key: 'chai-msa',
                enabled: this.isChaiEnabled(),
                gateOnService: 'chai-1-collabfold-msa',
                group: 'Chai'
            },
            {
                name: 'Chai-1 0.6.1 [FASTEST]',
                callback: this.runChaiLabPrediction,
                key: 'chai_lab',
                enabled: this.isChaiLabEnabled(),
                available: 'molecules',
                gateOnService: 'chai-lab-0.6.1',
                group: 'Chai'

            },
            {
                name: 'Chai-1 0.6.1+MSA',
                callback: this.runChaiLabMSAPrediction,
                key: 'chai_lab_msa',
                enabled: this.isChaiLabEnabled(),
                available: 'molecules',
                gateOnService: 'chai-lab-collabfold-msa-0.6.1',
                group: 'Chai'

            },
            {
                name: 'OpenFold-3 v1 [Experimental]',
                callback: this.runOF3V1Prediction,
                key: 'of3v1',
                enabled: this.isOpenFold3V1Enabled(),
                available: 'molecules',
                gateOnService: 'openfold3-v1',
                group: 'OpenFold'
            },
            {
                name: 'OpenFold-3 Aug22 [V. Experimental]',
                callback: this.runOF3Prediction,
                key: 'of3',
                enabled: this.isOpenFold3Enabled(),
                available: 'molecules',
                gateOnService: 'openfold3-dev-Aug22',
                group: 'OpenFold'
            },
            {
                name: 'OpenFold-3 via Nim [Experimental!]',
                enabled: this.isOpenFold3Enabled() && this.isNimPredictionEnabled(),
                callback: this.runOF3VNimPrediction,
                key: 'of3nim',
                available: 'molecules',
                group: 'OpenFold'
            },
            {
                name: 'ABodyBuilder2',
                callback: this.runABodyBuilder2,
                key: 'abb2',
                available: 'antibody',
                enabled: true,
                group: 'Antibody structure',
                gateOnService: 'abodybuilder2'
            },
            {
                name: 'ABodyBuilder3',
                callback: this.runABodyBuilder3Prediction,
                key: 'abb3',
                available: 'antibody',
                enabled: true,
                group: 'Antibody structure',
                gateOnService: 'abodybuilder3'
            },
            {
                name: 'Ibex',
                callback: this.runIbexPrediction,
                key: 'ibex',
                available: 'antibody',
                enabled: true,
                group: 'Antibody structure',
                gateOnService: 'ibex'
            },
            {
                name: 'MOE 2024 Antibody',
                callback: this.runFullLengthPrediction2024,
                key: 'ab_moebatch2024',
                available: 'antibody',
                enabled: true,
                group: 'Antibody structure',
                gateOnService: 'ab_moebatch2024'
            },
            {
                name: 'NanoBodyBuilder2',
                callback: this.runNBodyBuilder2,
                key: 'nbb2',
                available: 'vhh',
                enabled: true,
                group: 'Antibody structure',
                gateOnService: 'nanobodybuilder2'
            },
            {
                name: 'ABodyBuilder',
                callback: this.runABodyBuilder,
                key: 'abb',
                available: 'antibody',
                group: 'Obsolete',
                gateOnService: 'abodybuilder'
            },
            {
                name: 'Full fab',
                callback: this.runFullLengthPrediction,
                key: 'ab_moebatch',
                available: 'antibody',
                enabled: true,
                group: 'Obsolete',
                gateOnService: 'ab_moebatch'
            },
        ]).map((m) => {return ({...m, callback: m.callback.bind(this)})});
    })

    render() {
        const {
            selection, columnarData, structureColorScheme, setStructureColorScheme, seqColumns, seqRefColumns,
            addValueToNewStructureColumn, isHeatmapVisible, heatmapNavBar, compact, structureSequence, 
            setStructureSequence, isAntibody, visibleStructures,
            alignments, references, primaryNavBarExtras
        } = this.props;

        // NB can't use the cached version here because render() fires before componentDidUpdate()
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, seqRefColumns, alignments, references, selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );

        const relevantErrors = structureInfos.map(({structureLabel}) => this.state.structureErrors[structureLabel]).filter((e) =>e);
        const errors = new Set(relevantErrors);
        if (this.props.structureError) errors.add(this.props.structureError);

        const availStructureKeys = this.getAvailStructureKeys();

        const visibleStructureInfos = structureInfos.filter(
            (si) => (si.url && visibleStructures.includes(si.structureKey)
        ));

        const structuresFromGYDE = visibleStructureInfos.map(
            (si) => si.structureLabel
        );

        const hasPLDDT = visibleStructureInfos.some(({structureKey, method, plddts}) => plddts || this.useDisorderAsPLDDT(structureKey, method));

        const structureInfo = structureInfos.length >= 1 ? structureInfos[0] : null;
        const predictionKey = structureInfo?.predictionKey;
        const hasRefStruct = this.getVal('reference_structure_url');
        const hasRef2Struct = this.getVal('reference_structure_2_url');
        const showingOtherReferenceStructure = structureInfo && !arrayCmp(structureInfo.dataIndices, structureInfo.selectedIndices);

        const methods = new Set(structureInfos.filter(({structureKey}) => visibleStructures.indexOf(structureKey) >= 0)
                                              .map((structureInfo) => structureInfo.method || structureInfo.url?.gyde_source));
        const method = methods.size > 0 ? Array.from(methods).join('; ') : undefined;

        return (
          <div>
            <div>{ this.state.mappingMessage }</div>
            { showingOtherReferenceStructure 
              ? <p>WARNING: The displayed structure is a designated reference and may not perfectly match the selected sequence</p>
              : undefined }
            {
              structuresFromGYDE.length > this.state.structureLimit 
              ? <div style={{
                    background: 'wheat',
                    borderWidth: '1rem',
                    borderRadius: '0.5rem',
                    padding: '1rem',
                    marginBottom: '1rem'}}
                >
                   Are you sure you want to load { structuresFromGYDE.length } structures?&nbsp;&nbsp;
                  <Button variant="contained" onClick={() => {this.setState({structureLimit: structuresFromGYDE.length})}}>Confirm</Button>
                </div>
              :undefined }

            <StructureNavBar
                setStructureColorScheme={setStructureColorScheme}
                colorScheme={structureColorScheme}
                columnarData={columnarData}
                selection={selection}
                addValueToNewStructureColumn={addValueToNewStructureColumn}
                structureSequence={structureSequence}
                setStructureSequence={setStructureSequence}
                hasReference={structureInfo?.hasReference}
                structureKeys={this.props.structureKeys}
                availStructureKeys={availStructureKeys}
                isHeatmapVisible={isHeatmapVisible}
                isAntibody={isAntibody}
                hasPLDDT={hasPLDDT}
                predictionKey={predictionKey}
                predictionsPending={this.state.predictionsPending}
                predictionsStatus={this.state.predictionsStatus}
                predictionMethods={this.getPredictionMethods()}
                structureInfos={structureInfos}
                compact={compact}
                sequenceCompact={this.props.sequenceCompact}
                visibleStructures={visibleStructures}
                toggleStructureVisibility={this.toggleStructureVisibility.bind(this)}
                setVisibleStructures={this.props.setVisibleStructures}

                autoSuperpose={this.props.autoSuperpose}
                setAutoSuperpose={this.props.setAutoSuperpose}

                primaryNavBarExtras={this.props.primaryNavBarExtras}
            />

            {(isHeatmapVisible && structureColorScheme.includes('heatmap')) ? heatmapNavBar : null }

            <React.Fragment>
                <div style={{color: 'red'}}>{ errors.size > 0 ? Array.from(errors).join('; ') : undefined }</div>
                <div>{this.state.structureProgress}</div>

                { this.state.plugin
                  ? <div style={{
                        position: 'relative',
                        height: compact ? '400px' : '550px',
                        display: 'flex'}}>
                        <Plugin plugin={this.state.plugin} />
                    </div>
                  : undefined }

                { method
                    ? <Typography
                        sx={{
                            display: 'inline-block',
                            ml: '10px',
                            borderRadius: "8px",
                            padding: '4px',
                            fontSize: '12px',
                            backgroundColor: 'primary.light',
                            color: '#000',
                        }}
                    >
                        Source: {method}
                    </Typography>
                    : null 
                }
            </React.Fragment>

            <StructurePredictDialog {...(this.state.showingCzekoladaUI || {})}
                                    dataColumns={this.props.dataColumns}
                                    columnTypes={this.props.columnTypes}
                                    structureKeys={this.props.structureKeys}
                                    columnarData={this.props.columnarData}
                                    onHide={() => this.setState({showingCzekoladaUI: undefined})} />

            <NimPredictionDialog {...(this.state.showingNimUI || {})}
                                 onHide={() => this.setState({showingNimUI: undefined})} />

          </div>
        );
    }

    runFullLengthPrediction(probeOnly=false, reconnect=false) {
        probeOnly = probeOnly || reconnect;
        const {
            selection, columnarData, seqColumns, structureSequence, visibleStructures, 
            seqRefColumns, alignments, references, isAntibody
        } = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, seqRefColumns, alignments, references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting full Fab structures typically takes >5 minutes.  Proceed?';
        if (structureInfos.length > 1) {
            msg = `***WARNING***: will attempt to predict ${structureInfos.length} structures\n\n${msg}`;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach((structureInfo) => {
            const {hc, lc} = structureInfo;
            if (!hc || !lc) {
                if (!probeOnly) console.log('Not able to find sequences for antibody prediction');
                return;
            }

            const fasta = new Blob(
                [`>VL\n${lc}\n>VH\n${hc}\n`],
                {
                    type: 'application/fasta'
                }
            );

            const formData = new FormData();
            formData.append('input', fasta, 'input.fa');

            this.runStructurePrediction(
                'ab_moebatch', 'moe_full_length_fab', 'ab_moebatch', formData, 
                [{label: 'Output file', type: 'uri'}], structureInfo, probeOnly, reconnect
            );
        });
    }

    runFullLengthPrediction2024(probeOnly=false, reconnect=false) {
        const {seqColumns, columnTypes, slivkaService} = this.props;

        return this.runCzekoladaStructurePredictionProps({
            method: 'ab_moebatch2024',
            methodKey: 'ab_moebatch2024',
            inputConstructor: (structureInfo) => {
                const {hc, lc} = structureInfo;
                if (!hc || !lc) {
                    throw Error('Not able to find sequences for antibody prediction');
                }

                const fasta = new Blob(
                    [`>VL\n${lc}\n>VH\n${hc}\n`],
                    {
                        type: 'application/fasta'
                    }
                );

                return {input: fasta, numbering: 'Kabat-KabatFv'};
            },
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'ab_moebatch2024';
                const structureInfo = result.structureInfo;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [{label: 'Output PDB file', type: 'uri'}, {label: 'Data file', type: 'json'}]
                );

                for (const r of fetchResult || []) {
                    if (r.label === 'Output PDB file') {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'ab_moebatch2024'
                            },
                            jobName,
                            true
                        );

                        this.props.setVisibleStructures([jobName]);
                    } else if (r.label === 'Data file') {
                        const data = r.data;
                        if (data && data.SEPP && data.SEPP.fld && data.SEPP.data) {
                            const dataObj = {};
                            const exclusions = new Set(['mseq', 'GNE_ID']);
                            data.SEPP.fld.forEach((field, i) => {
                                if (exclusions.has(field)) return;

                                this.props.updateDatum(structureInfo.dataIndices[0], 'moe_' + field, data.SEPP.data[0][i], true);
                            });
                        } 

                        if (data && data.QDESC && data.QDESC.fld && data.QDESC.data) {
                            const dataObj = {};
                            const exclusions = new Set(['mseq', 'GNE_ID']);
                            data.QDESC.fld.forEach((field, i) => {
                                if (exclusions.has(field)) return;

                                this.props.updateDatum(structureInfo.dataIndices[0], 'moe_q_' + field, data.QDESC.data[0][i], true);
                            });
                        } 
                    }
                }
            },
            reconnect,
            hideParams: ['input'],
            constrainParams: ['aptml'],
            message: 'NB current version runs SEPP by default, this will be optional in future',
            constrainOptions: {format: ['Fab', 'Ig']}
        })
    }

    async runStructurePrediction(
        method, structureName, methodKey, formData, extractResults, structureInfo, probeOnly, reconnect
    ) {
        const {columnarData, slivkaService, updateSelection, addValueToNewStructureColumn, setVisibleStructures} = this.props;
        const {predictionKey, dataIndices} = structureInfo;

        if ((this.state.predictionsPending[methodKey] || {})[predictionKey]) {
            if (!probeOnly) console.log('Prediction already running');
            return;
        }

        if (!this.currentlyPredicting[method]) this.currentlyPredicting[method] = new Set([]);
        if (this.currentlyPredicting[method].has(dataIndices[0])) return;

        const oldStructureRecord = (columnarData[structureName] || [])[structureInfo.dataIndices[0]],
              pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
              pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined;

        if (!pending && reconnect) {
            return;
        }

        this.currentlyPredicting[method].add(dataIndices[0]);
        this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, true));

        if (!probeOnly) {
            this.props.pinger('analysis.' + method);
        }

        let firstPing = true;
        const listener = async (result) => {
            if (result.finished || !result.id) {
                if (result.status === 'COMPLETED') {
                    const fetchResult = await slivkaService.fetch(
                        result.id,
                        extractResults
                    );

                    let structureData = null;
                    if (fetchResult) {
                        structureData = fetchResult[0].data;

                        this.currentlyPredicting[method].delete(dataIndices[0])
                        addValueToNewStructureColumn(
                            dataIndices[0],
                            {_gyde_analysis: 'success', '_gyde_job_url': result['@url'], '_gyde_url': structureData, '_gyde_method': method},
                            structureName
                        );

                        if (!probeOnly) {
                            setVisibleStructures([structureName]);
                            updateSelection([dataIndices[0]]);
                        }
                    }
                } else if (pending || !probeOnly) {
                    addValueToNewStructureColumn(
                        dataIndices[0],
                        {_gyde_analysis: 'error', _gyde_message: (method + ' status ' + result.status) || 'SUBMIT_FAILED', _gyde_job_url: result['@url']},
                        structureName
                    );
                } 
                
                this.currentlyPredicting[method].delete(dataIndices[0])
                this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
            } else {
                if (firstPing) {
                    addValueToNewStructureColumn(
                        dataIndices[0],
                        {_gyde_analysis: 'pending', _gyde_job_id: result.id, _gyde_job_url: result['@url']}, structureName
                    );
                    firstPing = false;
                }
                this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null /* no update */));
            }
        };

        if (pending) {
            this.slivkaSubscriptions.push(slivkaService.watchJob(pending, listener, pendingURL));
        } else {
            const service = slivkaService.services?.find((s) => s.id === method);
            if (!service) {
                if (!probeOnly) {
                    alert('Cannot find service ' + method);
                }
                this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
                return;
            }

            const ss = await slivkaService.submit(
                method,
                formData,
                {useCache: probeOnly ? 'probe' : true},
                listener
            );
            this.slivkaSubscriptions.push(ss);
        }
    }

    runABodyBuilder(probeOnly=false, reconnect=false) {
        probeOnly = probeOnly || reconnect;
        const {selection, columnarData, seqColumns, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );

        let msg = 'Predicting antibody structures with ABodyBuilder can take several minutes.  Proceed?';
        if (structureInfos.length > 1) {
            msg = `***WARNING***: will attempt to predict ${structureInfos.length} structures\n\n${msg}`;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach((structureInfo) => {
            const {hc, lc} = structureInfo;
            if (!hc || !lc) {
                if (!probeOnly) console.log('Not able to find sequences for antibody prediction');
                return;
            }

            const formData = new FormData();
            formData.append('heavy', hc);
            formData.append('light', lc);
            formData.append('target_name', 'predicted');
            formData.append('renumber', 'kabat');

            this.runStructurePrediction(
                'abodybuilder', 'abodybuilder', 'abb', formData, 
                [{label: 'Best predicted structure', type: 'uri'}], structureInfo, probeOnly, reconnect
            );
        });
    }

    runABodyBuilder2(probeOnly=false, reconnect=false) {
        probeOnly = probeOnly || reconnect;
        const {
            selection, columnarData, seqColumns, structureSequence, visibleStructures, seqRefColumns, alignments, references, isAntibody
        } = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, seqRefColumns, alignments, references, reconnect ? true : selection, 
            this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting antibody structures with ABodyBuilder2 can take several minutes.  Proceed?';
        if (structureInfos.length > 1) {
            msg = `***WARNING***: will attempt to predict ${structureInfos.length} structures\n\n${msg}`;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach((structureInfo) => {
            const {hc, lc} = structureInfo;
            if (!hc || !lc) {
                if (!probeOnly) console.log('Not able to find sequences for antibody prediction');
                return;
            }

            const formData = new FormData();
            formData.append('heavy', hc);
            formData.append('light', lc);
            formData.append('scheme', 'Kabat');

            this.runStructurePrediction(
                'abodybuilder2',
                'abodybuilder2',
                'abb2',
                formData,
                [{label: 'Top ranked refined model', type: 'uri'}],
                structureInfo,
                probeOnly,
                reconnect,
                '/api2'
            );
        });
    }

    runNBodyBuilder2(probeOnly=false, reconnect=false) {
        probeOnly = probeOnly || reconnect;
        const {selection, columnarData, seqColumns, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting antibody structures with NanoBodyBuilder2 can take several minutes.  Proceed?';
        if (structureInfos.length > 1) {
            msg = `***WARNING***: will attempt to predict ${structureInfos.length} structures\n\n${msg}`;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach((structureInfo) => {
            const {hc, lc} = structureInfo;
            if (!hc || lc) {
                if (!probeOnly) console.log('Not able to find sequences for nanobody prediction');
                return;
            }

            const formData = new FormData();
            formData.append('heavy', hc);
            formData.append('scheme', 'Kabat');

            this.runStructurePrediction(
                'nanobodybuilder2',
                'nanobodybuilder2',
                'nbb2',
                formData,
                [{label: 'Top ranked refined model', type: 'uri'}],
                structureInfo,
                probeOnly,
                reconnect,
                '/api2'
            );
        });
    }

    runAlphafoldPrediction(probeOnly=false, reconnect=false) {
        probeOnly = probeOnly || reconnect;
        const {selection, columnarData, seqColumns, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting Alphafold structures takes a long time -- potentially hours for large complexes.  Proceed?';
        if (structureInfos.length > 20 && !probeOnly) {
            alert('We currently do not allow Alphafold to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
            return;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach(async (structureInfo) => {
            const structureName = 'alphafold_ranked_0'; // CHECK!
            const methodKey = 'af2';
            // this.runStructurePrediction('abodybuilder', 'abodybuilder', 'afPredictionPending', 'afPredictionStatus', formData, [{label: 'Best predicted structure', type: 'uri'}], structureInfo, probeOnly, reconnect);
            const {sequences, predictionKey} = structureInfo;

            if ((this.state.predictionsPending[methodKey] || {})[predictionKey]) {
                if (!probeOnly) console.log('Prediction already running');
                return;
            }

            const fasta = new Blob(
                [sequences.map((s, i) => `>seq${i}\n${s}\n`).join('\n')],
                {
                    type: 'application/fasta'
                }
            );

            const formData = new FormData();
            formData.append('input', fasta, 'input.fa');
            if (sequences.length > 1) {
                formData.append('multimer', 'true');
            }

            const oldStructureRecord = (columnarData[structureName] || [])[structureInfo.dataIndices[0]],
                  pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                  pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined;

            if (!pending && reconnect) return;

            this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, true));

            if (!probeOnly) {
                this.props.pinger('analysis.alphafold')
            }

            let firstPing = true;
            const listener = async (result) => {
                if (result.finished || !result.id) {
                    if (result.status === 'COMPLETED') {
                        const fetchResult = await slivkaService.fetch(
                            result.id,
                            [
                                {label: 'Predicted structure', type: 'url'},
                                {label: 'Predicted Aligned Error visualization', type: 'url', required: false},
                                {label: 'Predicted LDDT visualization', type: 'url', required: false}
                            ],
                        );

                        if (fetchResult) {
                            for (const r of fetchResult) {
                                if (r.label === 'Predicted structure') {
                                    const splitPath = r.path.split('/');
                                    const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                                    const predName = splitPath[1].replace('.pdb', '');
                                    const structureModelName = 'alphafold_' + predName;
                                    this.props.addValueToNewStructureColumn(
                                        structureInfo.dataIndices[0],
                                        {
                                            _gyde_analysis: 'success',
                                            _gyde_job_url: result['@url'],
                                            _gyde_url: r.data,
                                            _gyde_method: 'Alphafold',
                                            _gyde_chains: sequences.map((_, i) => String.fromCharCode(65 + i))
                                        },
                                        structureModelName,
                                        structureModelName === structureName
                                    );
                                } else if (r.label === 'Predicted Aligned Error visualization') {
                                    this.props.updateDatum(
                                        structureInfo.dataIndices[0],
                                        'pae_url',
                                        r.data,
                                        true
                                    );
                                } else if (r.label === 'Predicted LDDT visualization') {
                                    this.props.updateDatum(
                                        structureInfo.dataIndices[0],
                                        'lddt_url',
                                        r.data,
                                        true
                                    );
                                }
                            }

                            if (!probeOnly) {
                                this.props.setVisibleStructures([structureName]);
                                this.props.setStructureColorScheme('pLDDT');
                            }
                        }
                    } else {
                        if (pending || !probeOnly) {
                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                {
                                    _gyde_analysis: 'error',
                                    _gyde_message: ('Alphafold status ' + result.status) || 'SUBMIT_FAILED',
                                    _gyde_job_url: result['@url']
                                },
                                structureName
                            );
                        }
                    }

                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
                } else {
                    if (firstPing) {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {_gyde_analysis: 'pending', _gyde_job_id: result.id, _gyde_job_url: result['@url']},
                            structureName
                        );
                        firstPing = false;
                    }
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null /* no update */));
                }
            };

            if (pending) {
                this.slivkaSubscriptions.push(slivkaService.watchJob(pending, listener, pendingURL));
            } else {
                const ss = await slivkaService.submit(
                    'af2',
                    formData,
                    {useCache: probeOnly ? 'probe' : true},
                    listener
                );
                this.slivkaSubscriptions.push(ss);
            }
        });
    }

    runBoltzPrediction(probeOnly=false, reconnect=false) {
        probeOnly = probeOnly || reconnect;
        const {selection, columnarData, seqColumns, columnTypes, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting Boltz structures takes a long time -- potentially hours for large complexes.  Proceed?';
        if (structureInfos.length > 20 && !probeOnly) {
            alert('We currently do not allow Boltz to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
            return;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach(async (structureInfo) => {
            const methodKey = 'boltz'
            const structureName = 'boltz_0';
            const statusKey = 'boltzPredictionStatus', pendingKey = 'boltzPredictionPending';
            const {proteinSequences, sequences, ligands, dnas, rnas, predictionKey} = structureInfo;

            if ((this.state.predictionsPending[methodKey] || {})[predictionKey]) {
                if (!probeOnly) console.log('Prediction already running');
                return;
            }

            let chainSeed = 0;
            const nextChain = () => String.fromCharCode(65+(chainSeed++));
            const requestEntries = [];

            for (const s of proteinSequences) {
                requestEntries.push(`>${nextChain()}|protein\n${s}`);
            }
            for (const l of (ligands || [])) {
                requestEntries.push(`>${nextChain()}|smiles\n${l}`);
            }
            for (const d of (dnas || [])) {
                requestEntries.push(`>${nextChain()}|dna\n${d}`);
            }
            for (const r of (rnas || [])) {
                requestEntries.push(`>${nextChain()}|rna\n${r}`);
            }

            const fasta = new Blob(
                [requestEntries.join('\n')],
                {
                    type: 'application/fasta'
                }
            );

            const formData = new FormData();
            formData.append('input', fasta, 'input.fa');
            formData.append('output_format', 'pdb');
            formData.append('diffusion_samples', '5')

            const oldStructureRecord = (columnarData[structureName] || [])[structureInfo.dataIndices[0]],
                  pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                  pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined;

            if (!pending && reconnect) return;

            this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, true));

            if (!probeOnly) {
                this.props.pinger('analysis.boltz')
            }

            let firstPing = true;
            const listener = async (result) => {
                if (result.finished || !result.id) {
                    if (result.status === 'COMPLETED') {
                        const fetchResult = await slivkaService.fetch(
                            result.id,
                            [
                                {label: 'Predicted structure (PDB)', type: 'url', required: true},
                                {label: 'pLDDT arrays', type: 'arrayBuffer', required: false}
                            ],
                        );

                        if (fetchResult) {
                            const plddtArrays = {};
                            for (const r of fetchResult) {
                                if (r.label === 'pLDDT arrays') {
                                    const splitPath = r.path.split('/');
                                    const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                                    const modelMatch = /(model_.+)\.npz$/.exec(fileName);
                                    if (modelMatch) {
                                        const modelName = modelMatch[1];
                                        const plddt = await parseBoltzPLDDTs(r.data);
                                        plddtArrays[modelName] = plddt;
                                    }
                                }
                            }

                            for (const r of fetchResult) {
                                if (r.label === 'Predicted structure (PDB)' /*r.path.endsWith('.pdb')*/) {
                                    const splitPath = r.path.split('/');
                                    const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                                    let plddt = undefined;
                                    let predName = '0'
                                    const modelMatch = /(model_(.+))\.pdb$/.exec(fileName);
                                    if (modelMatch) {
                                        const modelName = modelMatch[1];
                                        predName = modelMatch[2]
                                        plddt = plddtArrays[modelName];
                                    }
                                    const structureModelName = 'boltz_' + predName;

                                    const jobResult = {
                                        _gyde_analysis: 'success',
                                        _gyde_job_url: result['@url'],
                                        _gyde_url: r.data,
                                        _gyde_method: 'Boltz-1',
                                        _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                                    };
                                    if (plddt) {
                                        let index = 0;
                                        jobResult._gyde_plddts = seqColumns.map(({column}, colIndex) =>  {
                                            if ((columnTypes[column] ?? 'protein') === 'protein') {
                                                const p = [];
                                                for (let i = 0; i < sequences[colIndex].length; ++i) {
                                                    p.push(plddt[index++])
                                                }
                                                return p;
                                            } else {
                                                return;
                                            }
                                        });
                                    }

                                    this.props.addValueToNewStructureColumn(
                                        structureInfo.dataIndices[0],
                                        jobResult,
                                        structureModelName,
                                        structureModelName === structureName
                                    );
                                }
                            }

                            this.props.setVisibleStructures([structureName]);
                            this.props.setStructureColorScheme('pLDDT');
                        }
                    } else {
                        if (pending || !probeOnly) {
                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                {_gyde_analysis: 'error', _gyde_message: ('Boltz-1 status ' + result.status) || 'SUBMIT_FAILED', _gyde_job_url: result['@url']},
                                structureName
                            );
                        }
                    }

                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
                } else {
                    if (firstPing) {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {_gyde_analysis: 'pending', _gyde_job_id: result.id, _gyde_job_url: result['@url']},
                            structureName
                        );
                        firstPing = false;
                    }
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null /* no update */));
                }
            };

            if (pending) {
                this.slivkaSubscriptions.push(slivkaService.watchJob(pending, listener, pendingURL));
            } else {
                const ss = await slivkaService.submit(
                    'boltz-1',
                    formData,
                    {useCache: probeOnly ? 'probe' : true},
                    listener
                );
                this.slivkaSubscriptions.push(ss);
            }
        });
    }

    getProteinChainLetters(seqColumns, columnTypes) {
        let index = 0;
        return seqColumns.map(({column}, i) =>  {
            if ((columnTypes[column] ?? 'protein') === 'protein') {
                return String.fromCharCode(65+(index++));
            } else {
                return;
            }
        })
    }

    runCzekoladaStructurePredictionProps(props) {
        const {method, methodKey, reconnect, onComplete, structureSuffixes=['']} = props;
        const listener = async (result) => {
            const jobName = result.jobName || methodKey;
            const structureName = jobName + structureSuffixes[0];
            const structureInfo = result.structureInfo;
            const firstPing = result.firstPing;
            const predictionKey = structureInfo.predictionKey;
            const pending = undefined, probeOnly=false; // FIXME

            if (firstPing) {
                // We want to *always* run this on first ping, otherwise the dialog box won't close on cache hits
                this.setState({showingCzekoladaUI: undefined});
            }

            if (result.finished || !result.id) {
                if (result.status === 'COMPLETED') {
                    onComplete(result);
                } else {
                    if (pending || !probeOnly) {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {
                                _gyde_analysis: 'error', 
                                _gyde_message: (methodKey + ' status ' + result.status) || 'SUBMIT_FAILED',
                                _gyde_job_url: result['@url'],
                                _gyde_method_key: methodKey,
                                _gyde_job_name: jobName
                            },
                            structureName
                        );
                    }
                }

                this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
            } else {
                if (firstPing) {
                    this.props.addValueToNewStructureColumn(
                        structureInfo.dataIndices[0],
                        {
                            _gyde_analysis: 'pending',
                            _gyde_job_id: result.id,
                            _gyde_job_url: result['@url'],
                            _gyde_method_key: methodKey,
                            _gyde_job_name: jobName
                        },
                        structureName
                    );
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, true));
                } else {
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null));
                }
            }
        };

        const {selection, columnarData, dataColumns, seqColumns, columnTypes, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );

        if (reconnect) {
            const structureName = methodKey + structureSuffixes[0];     // only for legacy jobs

            structureInfos.forEach((structureInfo) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;
                const dataIndex = structureInfo.dataIndices[0];

                for (const column of dataColumns) {
                    const oldStructureRecord = (columnarData[column] || [])[dataIndex];

                    if (oldStructureRecord && oldStructureRecord._gyde_method_key === methodKey || column === structureName) {
                        const pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                              pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined,
                              reconnectJobName = oldStructureRecord?._gyde_job_name ?? methodKey;


                        if (pending) {
                            const augListener = (status) => {
                                listener({...status, structureInfo, jobName: reconnectJobName});
                            };
                            this.slivkaSubscriptions.push(slivkaService.watchJob(pending, augListener, pendingURL));
                        }
                    }
                }
            })
        } else {
            if (structureInfos.length > 20) {
                alert('We currently do not allow ' + method + ' to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
                return;
            }

            const filteredStructureInfos = structureInfos.filter((s) => !(this.state.predictionsPending[methodKey] || {})[s.predictionKey]);
            if (filteredStructureInfos.length === 0) {
                alert('Predictions are pending for all selected entries');
                return;
            } else if (filteredStructureInfos.length < structureInfos.length) {
                alert('Predictions are pending for some of these entries, only entries without a pending ' + method + ' prediction will run');
            }

            this.setState({showingCzekoladaUI: {...props, structureInfos, onJobSubmitted: listener}});
        }
    }

    runMSA(sequence, returnType='id', quiet=false) {
        const slivkaService = this.props.slivkaService;
        return new Promise(async (resolve, reject) => {
            const seqFasta = new Blob([`>prot\n${sequence}\n`], {type: 'application/fasta'});     // FIXME!!!!!!!!
            const formData = new FormData();
            formData.append('input-fasta', seqFasta);

            const service = this.useCollabServerMSAs() ? 'collabfold-proxy' : 'collabfold_search';
            if (this.useCollabServerMSAs()) {
                if (!quiet && !window.confirm('Sending sequences to a public MSA server -- okay?')) {
                    return reject('Not sent to public MSA server');
                }
            }

            try {
                await slivkaService.submit(service, formData, {useCache: true}, async (status) => {
                    if (status?.status === 'COMPLETED') {
                        const [{data}] = await slivkaService.fetch(status['id'], [{label: 'msa', type: returnType}]);
                        resolve(data);
                    } else if (status?.status === 'FAILED') {
                        reject('MSA failed');
                    }
                });
            } catch (err) {
                reject(err.messsage ?? err);
            }
        });
    }

    runCzekoladaStructurePredictionMSA(props) {
        const {method, methodKey, reconnect, onComplete, structureSuffixes=[''], inputConstructor} = props;
        const {selection, columnarData, dataColumns, seqColumns, columnTypes, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;

        const service = slivkaService.services.find((s) => s.id === method);

        const listener = async (result) => {
            const jobName = result.jobName || methodKey;
            const structureName = jobName + structureSuffixes[0];
            const structureInfo = result.structureInfo;
            const firstPing = result.firstPing;
            const predictionKey = structureInfo.predictionKey;
            const pending = undefined, probeOnly=false; // FIXME

            if (firstPing) {
                // We want to *always* run this on first ping, otherwise the dialog box won't close on cache hits
                // this.setState({showingCzekoladaUI: undefined});
            }

            if (result.finished || !result.id) {
                if (result.status === 'COMPLETED') {
                    onComplete(result);
                } else {
                    if (pending || !probeOnly) {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {
                                _gyde_analysis: 'error',
                                _gyde_message: (methodKey + ' status ' + result.status) || 'SUBMIT_FAILED',
                                _gyde_job_url: result['@url'],
                                _gyde_method_key: methodKey,
                                _gyde_job_name: jobName
                            },
                            structureName
                        );
                    }
                }

                this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
            } else {
                if (firstPing) {
                    this.props.addValueToNewStructureColumn(
                        structureInfo.dataIndices[0],
                        {
                            _gyde_analysis: 'pending',
                            _gyde_job_id: result.id,
                            _gyde_job_url: result['@url'],
                            _gyde_method_key: methodKey,
                            _gyde_job_name: jobName
                        },
                        structureName
                    );
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, true));
                } else {
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null));
                }
            }
        };

        const onJobReady = async (structureInfo, inputs, inputConstructor, predictionOptions, jobName) => {
            jobName = jobName || methodKey;
            const structureName = jobName + structureSuffixes[0];

            for (const i of props.replacedInputs || []) {
                delete inputs[i];
            }
            const fixedInputs = await preUploadFiles(service, inputs)
            this.setState({showingCzekoladaUI: undefined});

            const seqToMSAName = {};
            structureInfo.proteinSequences.forEach((s, i) => {
                if (s) {
                    const chain = String.fromCharCode(65+i);
                    if (!seqToMSAName[s]) seqToMSAName[s] = [];
                    seqToMSAName[s].push(`msa${chain}.a3m`);
                }
            });

            this.props.addValueToNewStructureColumn(
                structureInfo.dataIndices[0],
                {
                    _gyde_analysis: 'pending',
                    _gyde_message: 'Building MSAs',
                    _gyde_method_key: methodKey,
                    _gyde_job_name: jobName,
                    _gyde_continue_after_msa: {...fixedInputs, _gyde_prediction_options: predictionOptions}
                },
                structureName
            );

            const uniqSeqs = Array.from(Object.entries(seqToMSAName));

            let msas;
            try {
                msas = await Promise.all(uniqSeqs.map(([s, _]) => this.runMSA(s)));
            } catch (err) {
                console.log(err);
                this.props.addValueToNewStructureColumn(
                    structureInfo.dataIndices[0],
                    {
                        _gyde_analysis: 'error',
                        _gyde_message: 'MSAs failed ' + (err.message ?? err),
                        _gyde_method_key: methodKey,
                        _gyde_job_name: jobName
                    },
                    structureName
                );
                return;
            }

            const structureParams = inputConstructor(structureInfo, predictionOptions);
            const params = {...fixedInputs, ...structureParams};
            let firstPing = true;
            const augListener = ((status) => {
                listener({...status, structureInfo: structureInfo, firstPing, jobName});
                firstPing = false;
            });

            const formData = configMapToFormData(service, params);
            for (let i = 0; i < msas.length; ++i) {
                const msaID = msas[i];
                for (const msaName of uniqSeqs[i][1]) {
                    formData.append('msa', `${msaID};filename=${msaName}`);
                }
            }

            slivkaService.submit(
                method,
                formData,      
                {useCache: true},
                augListener
            );
        };

        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );

        if (reconnect) {
            const structureName = methodKey + structureSuffixes[0];     // only for legacy jobs
            structureInfos.forEach((structureInfo) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;
                const dataIndex = structureInfo.dataIndices[0];

                for (const column of dataColumns) {
                    const oldStructureRecord = (columnarData[column] || [])[dataIndex];

                    if (oldStructureRecord && oldStructureRecord._gyde_method_key === methodKey || column === structureName) {
                        const pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                              pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined,
                              continueAfterMSAs = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_continue_after_msa : undefined,
                              reconnectJobName = oldStructureRecord?._gyde_job_name ?? methodKey;

                        if (pending) {
                            const augListener = (status) => {
                                listener({...status, structureInfo, jobName: reconnectJobName});
                            };
                            this.slivkaSubscriptions.push(slivkaService.watchJob(pending, augListener, pendingURL));
                        } else if (continueAfterMSAs) {
                            const predictionOptions = continueAfterMSAs._gyde_prediction_options ?? {};
                            const fixedInputs = {...continueAfterMSAs};
                            delete fixedInputs._gyde_prediction_options;
                            onJobReady(structureInfo, fixedInputs, inputConstructor, predictionOptions, reconnectJobName);
                        }
                    }
                }
            });
        } else {
            if (structureInfos.length > 20) {
                alert('We currently do not allow ' + method + ' to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
                return;
            }

            const filteredStructureInfos = structureInfos.filter((s) => !(this.state.predictionsPending[methodKey] || {})[s.predictionKey]);
            if (filteredStructureInfos.length === 0) {
                alert('Predictions are pending for all selected entries');
                return;
            } else if (filteredStructureInfos.length < structureInfos.length) {
                alert('Predictions are pending for some of these entries, only entries without a pending ' + method + ' prediction will run');
            }

            this.setState({showingCzekoladaUI: {...props, structureInfos, onJobSubmitted: listener, onJobReady}});
        }
    }


    runNimStructurePredictionMSA(props) {
        const {method, methodKey, endpoint, reconnect, onComplete, inputConstructor, structureSuffixes=['']} = props;
        const {selection, columnarData, dataColumns, seqColumns, columnTypes, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;

        const onJobReady = async (structureInfo, token) => {
            let jobName = methodKey;
            const structureName = jobName + structureSuffixes[0];

            this.setState({showingNimUI: undefined});

            const seqToMSAName = {};
            structureInfo.proteinSequences.forEach((s, i) => {
                if (s) {
                    const chain = String.fromCharCode(65+i);
                    if (!seqToMSAName[s]) seqToMSAName[s] = [];
                    seqToMSAName[s].push(`msa${chain}.a3m`);
                }
            });

            this.props.addValueToNewStructureColumn(
                structureInfo.dataIndices[0],
                {
                    _gyde_analysis: 'pending',
                    _gyde_message: 'Building MSAs',
                    _gyde_method_key: methodKey,
                    _gyde_continue_after_msa_nim: {_gyde_nim_key: token}
                },
                structureName
            );

            const uniqSeqs = Array.from(Object.entries(seqToMSAName));

            let msas;
            try {
                msas = await Promise.all(uniqSeqs.map(([s, _]) => this.runMSA(s, 'text', reconnect)));
            } catch (err) {
                console.log(err);
                this.props.addValueToNewStructureColumn(
                    structureInfo.dataIndices[0],
                    {
                        _gyde_analysis: 'error',
                        _gyde_message: 'MSAs failed ' + (err.message ?? err),
                        _gyde_method_key: methodKey,
                        _gyde_job_name: jobName
                    },
                    structureName
                );
                return;
            }

            const msaDict = {};
            uniqSeqs.forEach(([s, _], i) => {
                msaDict[s] = msas[i];
            });

            const structureParams = inputConstructor(structureInfo, msaDict);

            const resp = await fetch(endpoint, {
                method: 'POST',
                body: JSON.stringify(structureParams),
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'NVCF-POLL-SECONDS': '300',
                    'Authorization': `Bearer ${token}`
                }
            })

            if (!resp.ok) {
                this.props.addValueToNewStructureColumn(
                    structureInfo.dataIndices[0],
                    {
                        _gyde_analysis: 'error',
                        _gyde_message: 'Nim prediction failed',
                        _gyde_method_key: methodKey,
                        _gyde_job_name: jobName
                    },
                    structureName
                );
            } else {
                const body = await resp.json();
                onComplete(body, structureInfo);
            }
        };

        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );

        if (reconnect) {
            structureInfos.forEach((structureInfo) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;
                const dataIndex = structureInfo.dataIndices[0];

                for (const column of dataColumns) {
                    const oldStructureRecord = (columnarData[column] || [])[dataIndex];

                    if (oldStructureRecord && oldStructureRecord._gyde_method_key === methodKey) {
                        const pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                              continueAfterMSAs = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_continue_after_msa_nim : undefined;

                        if (continueAfterMSAs) {
                            onJobReady(structureInfo, continueAfterMSAs._gyde_nim_key);
                        }
                    }
                }
            });
        } else {
            if (structureInfos.length > 20) {
                alert('We currently do not allow ' + method + ' to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
                return;
            }

            const filteredStructureInfos = structureInfos.filter((s) => !(this.state.predictionsPending[methodKey] || {})[s.predictionKey]);
            if (filteredStructureInfos.length === 0) {
                alert('Predictions are pending for all selected entries');
                return;
            } else if (filteredStructureInfos.length < structureInfos.length) {
                alert('Predictions are pending for some of these entries, only entries without a pending ' + method + ' prediction will run');
            }

            this.setState({showingNimUI: {...props, structureInfos, onJobReady}});
        }
    }

    _runChaiLabPredictionGeneric(service, key, reconnect=false, msa=false) {
        const {seqColumns, columnTypes, slivkaService, restraints=[]} = this.props;
        const ligandColumns = Object.entries(this.props.columnTypes).filter(([_, type]) => type === 'smiles').map(([col, _]) => col);
        const proteinColumns = seqColumns.map((s) => s.column).filter((c) => (columnTypes[c] ?? 'protein') === 'protein');
        const dnaColumns = seqColumns.map((s) => s.column).filter((c) => (columnTypes[c] ?? 'protein') === 'dna');
        const rnaColumns = seqColumns.map((s) => s.column).filter((c) => (columnTypes[c] ?? 'protein') === 'rna');
        const structureSuffixes = ['_0', '_1', '_2', '_3', '_4'];

        const ChaiConfigWidget = (props) => {
            const [predictionOptions, updatePredictionOptions] = usePredictionOptions();
            const {useRestraints=false} = predictionOptions;

            if (restraints.length === 0) {
                return (
                    <div>No restraints currently configured, use the "Create restraint" option on the sequences menu if you wish to use restraints in your prediction</div>
                );
            } else {
                return (
                    <React.Fragment>
                         <FormControlLabel
                                  control={<Checkbox name="chai-restraints" checked={useRestraints} onChange={(ev) => updatePredictionOptions({useRestraints: ev.target.checked})} />}
                                  label="Use restraints" />
                    </React.Fragment>
                );
            }
        };

        const props = {
            method: service,
            methodKey: key,
            structureSuffixes,
            inputConstructor: (structureInfo, predictionOptions={}) => {
                const {useRestraints=false} = predictionOptions;
                const {proteinSequences, ligands, dnas, rnas, predictionKey, alignments} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntries = [];
                const columnNameToChain = {};
                const columnNameToSequence = {};
                const columnNameToGapMap = {};

                (proteinSequences || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[proteinColumns[i]] = chain;
                    columnNameToSequence[proteinColumns[i]] = s;
                    if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[proteinColumns[i]] = gapMap;
                    }
                    requestEntries.push(`>protein|name=${chain}\n${s}`);
                });
                (ligands || []).forEach((l, i) => {
                    const chain = nextChain();
                    requestEntries.push(`>ligand|name=${chain}\n${l}`);
                    columnNameToChain[ligandColumns[i]] = chain;
                });

                (dnas || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[dnaColumns[i]] = chain;
                    columnNameToSequence[dnaColumns[i]] = s;
                    if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[dnaColumns[i]] = gapMap;
                    }
                    requestEntries.push(`>dna|name=${chain}\n${s}`);
                });

                (rnas || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[rnaColumns[i]] = chain;
                    columnNameToSequence[rnaColumns[i]] = s;
                    if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[rnaColumns[i]] = gapMap;
                    }
                    requestEntries.push(`>rna|name=${chain}\n${s}`);
                });

                const fasta = new Blob(
                    [requestEntries.join('\n')],
                    {
                        type: 'application/fasta'
                    }
                );

                const params =  {input: fasta};

                if (useRestraints && restraints?.length > 0) {
                    function floatify(x) {
                        if (typeof(x) !== 'number') return '0.0';
                        let y = x.toString();
                        if (y.indexOf('.') < 0) y = y + '.0';
                        return y;
                    }


                    const chaiRestraints = restraints.flatMap(({id, fromSeqCol, fromSeqPos, fromLigand, toSeqCol, toSeqPos, toLigand, minAngstroms, maxAngstroms}) => {
                        const mappedFromPos = (columnNameToGapMap[fromSeqCol] || [])[fromSeqPos],
                              mappedToPos = (columnNameToGapMap[toSeqCol] || [])[toSeqPos];

                        if ((!fromLigand && typeof(mappedFromPos) !== 'number') || (!toLigand && typeof(mappedToPos) !== 'number')) {
                            alert('Problem mapping restraint coordinates');
                            return [];
                        }

                        if (fromLigand) {
                            return [{
                                restraint_id: id,
                                chainA: columnNameToChain[fromSeqCol],
                                res_idxA: '',
                                chainB: columnNameToChain[toSeqCol],
                                res_idxB: columnNameToSequence[toSeqCol][mappedToPos] + (mappedToPos + 1).toString(),
                                connection_type: 'pocket',
                                confidence: "1.0",
                                min_distance_angstrom: floatify(minAngstroms),
                                max_distance_angstrom: floatify(maxAngstroms),
                                comment: 'Guided by GYDE'
                            }];
                        } else if (toLigand) {
                            // We flip them in this case because Chai expects the ligand as chainA
                            return [{
                                restraint_id: id,
                                chainA: columnNameToChain[toSeqCol],
                                res_idxA: '',
                                chainB: columnNameToChain[fromSeqCol],
                                res_idxB: columnNameToSequence[fromSeqCol][mappedFromPos] + (mappedFromPos + 1).toString(),
                                connection_type: 'pocket',
                                confidence: "1.0",
                                min_distance_angstrom: floatify(minAngstroms),
                                max_distance_angstrom: floatify(maxAngstroms),
                                comment: 'Guided by GYDE'
                            }];
                        } else {
                            return [{
                                restraint_id: id,
                                chainA: columnNameToChain[fromSeqCol],
                                res_idxA: columnNameToSequence[fromSeqCol][mappedFromPos] + (mappedFromPos + 1).toString(),
                                chainB: columnNameToChain[toSeqCol],
                                res_idxB: columnNameToSequence[toSeqCol][mappedToPos] + (mappedToPos + 1).toString(),
                                connection_type: 'contact',
                                confidence: "1.0",
                                min_distance_angstrom: floatify(minAngstroms),
                                max_distance_angstrom: floatify(maxAngstroms),
                                comment: 'Guided by GYDE'
                            }];
                        }
                    });

                    const chaiRestraintsText = csvFormat(chaiRestraints);

                    params.constraints = new Blob([chaiRestraintsText], {type: 'text/csv'})
                }

                return params;
            },
            onComplete: async (result) => {
                const jobName = result.jobName ?? key;
                const structureInfo = result.structureInfo;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'Predicted structure (CIF)', type: 'url', required: true},
                    ],
                );

                if (fetchResult) {
                    for (const r of fetchResult) {
                        if (r.label === 'Predicted structure (CIF)') {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                            const predName = fileName.replace('pred.model_idx_', '').replace('.cif', '');
                            const structureModelName = jobName + '_' + predName;
                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                {
                                    _gyde_analysis: 'success',
                                    _gyde_job_url: result['@url'],
                                    _gyde_url: r.data,
                                    _gyde_method: service,
                                    _gyde_type: 'chemical/x-mmcif',
                                    _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                                },
                                structureModelName,
                                structureModelName === jobName + structureSuffixes[0]
                            );
                        }
                    }

                    this.props.setVisibleStructures([jobName + structureSuffixes[0]]);
                    this.props.setStructureColorScheme('pLDDT');
                }
            },
            reconnect,
            hideParams: ['constraints', 'input', 'msa'],
            constrainParams: ['constraints', 'input', 'msa'],
            message: <ChaiConfigWidget />
        };

        if (msa) {
            return this.runCzekoladaStructurePredictionMSA(props);
        } else {
            return this.runCzekoladaStructurePredictionProps(props);
        }
    }

    runChaiLabPrediction(reconnect=false) {
        return this._runChaiLabPredictionGeneric('chai-lab-0.6.1', 'chai_lab', reconnect);
    }

    runChaiLabMSAPrediction(reconnect=false) {
        return this._runChaiLabPredictionGeneric('chai-lab-collabfold-msa-0.6.1', 'chai_lab_msa', reconnect, true);
    }

    runBoltz1XPrediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService} = this.props;
        const structureSuffixes = ['_0', '_1', '_2', '_3', '_4'];

        return this.runCzekoladaStructurePredictionProps({
            method: 'boltz-1x',
            methodKey: 'boltz1X',
            structureSuffixes,
            inputConstructor: (structureInfo) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntries = [];

                for (const s of proteinSequences) {
                    requestEntries.push(`>${nextChain()}|protein\n${s}`);
                }
                for (const l of (ligands || [])) {
                    requestEntries.push(`>${nextChain()}|smiles\n${l}`);
                }
                for (const d of (dnas || [])) {
                    requestEntries.push(`>${nextChain()}|dna\n${d}`);
                }
                for (const r of (rnas || [])) {
                    requestEntries.push(`>${nextChain()}|rna\n${r}`);
                }

                const fasta = new Blob(
                    [requestEntries.join('\n')],
                    {
                        type: 'application/fasta'
                    }
                );

                return {
                    input: fasta,
                    output_format: 'pdb',
                    diffusion_samples: 5
                };
            },
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'boltz1X';
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'Predicted structure (PDB)', type: 'url', required: true},
                        {label: 'pLDDT arrays', type: 'arrayBuffer', required: false}
                    ],
                );

                if (fetchResult) {
                    const plddtArrays = {};
                    for (const r of fetchResult) {
                        if (r.label === 'pLDDT arrays') {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                            const modelMatch = /(model_.+)\.npz$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                const plddt = await parseBoltzPLDDTs(r.data);
                                plddtArrays[modelName] = plddt;
                            }
                        }
                    }

                    for (const r of fetchResult) {
                        if (r.label === 'Predicted structure (PDB)' /*r.path.endsWith('.pdb')*/) {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                            let plddt = undefined;
                            let predName = '0'
                            const modelMatch = /(model_(.+))\.pdb$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                predName = modelMatch[2]
                                plddt = plddtArrays[modelName];
                            }
                            const structureModelName = jobName + '_' + predName;

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'Boltz-1x',
                                _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                            };
                            if (plddt) {
                                let index = 0;
                                jobResult._gyde_plddts = seqColumns.map(({column}, colIndex) =>  {
                                    if ((columnTypes[column] ?? 'protein') === 'protein') {
                                        const p = [];
                                        for (let i = 0; i < sequences[colIndex].length; ++i) {
                                            p.push(plddt[index++])
                                        }
                                        return p;
                                    } else {
                                        return;
                                    }
                                });
                            }

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                structureModelName,
                                structureModelName === jobName + structureSuffixes[0]
                            );
                        }
                    }

                    this.props.setVisibleStructures([jobName + structureSuffixes[0]]);
                    this.props.setStructureColorScheme('pLDDT');
                }
            },
            reconnect,
            hideParams: ['input', 'output_format']
        });
    }

    runBoltz2Prediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService, restraints=[]} = this.props;
        const ligandColumns = Object.entries(this.props.columnTypes).filter(([_, type]) => type === 'smiles').map(([col, _]) => col);
        const structureSuffixes = ['_0', '_1', '_2', '_3', '_4'];

        const ligandColumnKeys = Object.entries(this.props.columnTypes || {}).filter(([k, v]) => v === 'smiles').map(([k, v]) => k)

        const LC4AWidget = (props) => {
            const [predictionOptions, updatePredictionOptions] = usePredictionOptions();
            const {ligandColumnForAffinity, useRestraints} = predictionOptions;

            return (
                <React.Fragment>
                    { ligandColumnKeys.length === 0
                      ? <div>No ligands, affinity prediction not available</div>
                      : <p>
                            <div>Select ligand column for affinity prediction</div>
                            <TextField
                              id="boltz2-ligand-select"
                              label="Affinity estimation "
                              value={ligandColumnForAffinity || '-'}
                              style={{width: '20rem'}}
                              margin='normal'
                              select
                              onChange={(ev) => updatePredictionOptions({ligandColumnForAffinity: ev.target.value})}
                            >
                                <MenuItem value="-">- No affinity prediction -</MenuItem>
                                { ligandColumnKeys.map((k) => (
                                    <MenuItem key={k} value={k}>{this.props.columnDisplayNames[k] || k}</MenuItem>
                                )) }
                            </TextField>
                        </p> }

                    { restraints.length === 0
                      ? <div>No restraints currently configured, use the "Create restraint" option on the sequences menu if you wish to use restraints in your prediction</div>
                      : <FormControlLabel
                              control={<Checkbox name="boltz-restraints" checked={useRestraints ?? false} onChange={(ev) => updatePredictionOptions({useRestraints: ev.target.checked})} />}
                              label="Use restraints" /> }
                </React.Fragment>
            );
        };

        return this.runCzekoladaStructurePredictionMSA({
            method: 'boltz-2',
            methodKey: 'boltz2',
            structureSuffixes,
            inputConstructor: (structureInfo, predictionOptions={}) => {
                const {ligandColumnForAffinity, useRestraints} = predictionOptions
                const {proteinSequences, ligands, dnas, rnas, predictionKey, alignments} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntriesByKey = {};
                const bindEntry = (type, seq, chain, props={}) => {
                    const key = type + '__' + seq;
                    if (!requestEntriesByKey[key]) {
                        requestEntriesByKey[key] = {
                            ...props,
                            type,
                            [type === 'ligand' ? 'smiles' : 'sequence']: seq,
                            id: []
                        };
                    }
                    requestEntriesByKey[key].id.push(chain);
                }
                const affinities = [];


                const columnNameToChain = {};
                const columnNameToGapMap = {};

                (proteinSequences || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[seqColumns[i].column] = chain;
                     if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[seqColumns[i].column] = gapMap;
                    }
                    bindEntry('protein', s, chain, {msa: `msa${chain}.a3m`});
                });
                ligands?.forEach((l, ligandIndex) => {
                    const chain = nextChain();
                    columnNameToChain[ligandColumns[ligandIndex]] = chain;
                    if (ligandColumnKeys[ligandIndex] === ligandColumnForAffinity) {
                        affinities.push(chain);
                    }
                    bindEntry('ligand', l, chain);
                });
                for (const d of (dnas || [])) {
                    bindEntry('dna', d, nextChain());
                }
                for (const r of (rnas || [])) {
                    bindEntry('rna', r, nextChain());
                }

                const requestEntries = Object.values(requestEntriesByKey).map(({type, id, ...rest}) => ({[type]: {id: id.length === 1 ? id[0]: id, ...rest}}));
                const request = {sequences: requestEntries};
                if (affinities.length > 0) {
                    request.properties = affinities.map((c) => ({affinity: {binder: c}}));
                }

                if (useRestraints && restraints?.length > 0) {
                    const boltzRestraints = restraints.flatMap(({id, fromSeqCol, fromSeqPos, fromLigand, toSeqCol, toSeqPos, toLigand, minAngstroms, maxAngstroms}) => {
                        const mappedFromPos = (columnNameToGapMap[fromSeqCol] || [])[fromSeqPos],
                              mappedToPos = (columnNameToGapMap[toSeqCol] || [])[toSeqPos];

                        if ((!fromLigand && typeof(mappedFromPos) !== 'number') || (!toLigand && typeof(mappedToPos) !== 'number')) {
                            alert('Problem mapping restraint coordinates');
                            return [];
                        }


                        if (fromLigand) {
                            return [{
                                pocket: {
                                    binder: columnNameToChain[fromSeqCol],
                                    contacts: [[columnNameToChain[toSeqCol], mappedToPos + 1]],
                                    max_distance: maxAngstroms
                                }
                            }];
                        } else if (toLigand) {
                            return [{
                                pocket: {
                                    binder: columnNameToChain[toSeqCol],
                                    contacts: [[columnNameToChain[fromSeqCol], mappedFromPos + 1]],
                                    max_distance: maxAngstroms
                                }
                            }];
                        } else {
                            alert('Chain-chain contacts currently not working in Boltz....')
                            return [];
                            /*
                            return ({
                                contact: {
                                    token1: [columnNameToChain[fromSeqCol], mappedFromPos + 1],
                                    token2: [columnNameToChain[toSeqCol], mappedToPos + 1],
                                    max_distance: maxAngstroms
                                }
                            })
                            */
                        }
                    });

                    if (boltzRestraints.length > 1) {
                        request.constraints = boltzRestraints;
                    }
                }


                const fasta = new Blob(
                    [JSON.stringify(request, null, 2)],
                    {
                        type: 'application/x-yaml'
                    }
                );

                return {
                    input: fasta,
                    output_format: 'pdb',
                    diffusion_samples: 5
                };
            },
            replacedInputs: ['input'],
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'boltz2';
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'Predicted structure (PDB)', type: 'url', required: true},
                        {label: 'pLDDT arrays', type: 'arrayBuffer', required: false},
                        {label: 'Affinity predictions', type: 'json', required: false}
                    ],
                );

                if (fetchResult) {
                    const plddtArrays = {};
                    for (const r of fetchResult) {
                        if (r.label === 'pLDDT arrays') {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                            const modelMatch = /(model_.+)\.npz$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                const plddt = await parseBoltzPLDDTs(r.data);
                                plddtArrays[modelName] = plddt;
                            }
                        }
                    }

                    for (const r of fetchResult) {
                        if (r.label === 'Affinity predictions') {
                            const {affinity_pred_value, affinity_probability_binary} = r.data;
                            this.props.updateDatum(structureInfo.dataIndices[0], 'boltz_affinity_pred', affinity_pred_value, true, true);
                            this.props.updateDatum(structureInfo.dataIndices[0], 'boltz_pIC50', (6-affinity_pred_value) * 1.364, true, true);
                            this.props.updateDatum(structureInfo.dataIndices[0], 'boltz_binding_probability', affinity_probability_binary, true, true);
                        } else if (r.label === 'Predicted structure (PDB)' /*r.path.endsWith('.pdb')*/) {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                            let plddt = undefined;
                            let predName = '0'
                            const modelMatch = /(model_(.+))\.pdb$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                predName = modelMatch[2]
                                plddt = plddtArrays[modelName];
                            }
                            const structureModelName = jobName + '_' + predName;

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'Boltz-2',
                                _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                            };
                            if (plddt) {
                                let index = 0;
                                jobResult._gyde_plddts = seqColumns.map(({column}, colIndex) =>  {
                                    if ((columnTypes[column] ?? 'protein') === 'protein') {
                                        const p = [];
                                        for (let i = 0; i < sequences[colIndex].length; ++i) {
                                            p.push(plddt[index++])
                                        }
                                        return p;
                                    } else {
                                        return;
                                    }
                                });
                            }

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                structureModelName,
                                structureModelName === jobName + structureSuffixes[0]
                            );
                        }
                    }

                    this.props.setVisibleStructures([jobName + structureSuffixes[0]]);
                    this.props.setStructureColorScheme('pLDDT');
                }
            },
            reconnect: reconnect,
            hideParams: ['input', 'output_format', 'msa'],
            constrainParams: undefined,
            message: <LC4AWidget />
        });
    }

    runBoltz221Prediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService, restraints=[]} = this.props;
        const ligandColumns = Object.entries(this.props.columnTypes).filter(([_, type]) => type === 'smiles').map(([col, _]) => col);
        const proteinColumns = seqColumns.map((s) => s.column).filter((c) => (columnTypes[c] ?? 'protein') === 'protein');
        const dnaColumns = seqColumns.map((s) => s.column).filter((c) => (columnTypes[c] ?? 'protein') === 'dna');
        const rnaColumns = seqColumns.map((s) => s.column).filter((c) => (columnTypes[c] ?? 'protein') === 'rna');
        const structureSuffixes = ['_0', '_1', '_2', '_3', '_4'];

        const ligandColumnKeys = Object.entries(this.props.columnTypes || {}).filter(([k, v]) => v === 'smiles').map(([k, v]) => k)

        const LC4AWidget = (props) => {
            const [predictionOptions, updatePredictionOptions] = usePredictionOptions();
            const {ligandColumnForAffinity, useRestraints} = predictionOptions;

            return (
                <React.Fragment>
                    { ligandColumnKeys.length === 0
                      ? <div>No ligands, affinity prediction not available</div>
                      : <p>
                            <div>Select ligand column for affinity prediction</div>
                            <TextField
                              id="boltz2-ligand-select"
                              label="Affinity estimation "
                              value={ligandColumnForAffinity || '-'}
                              style={{width: '20rem'}}
                              margin='normal'
                              select
                              onChange={(ev) => updatePredictionOptions({ligandColumnForAffinity: ev.target.value})}
                            >
                                <MenuItem value="-">- No affinity prediction -</MenuItem>
                                { ligandColumnKeys.map((k) => (
                                    <MenuItem key={k} value={k}>{this.props.columnDisplayNames[k] || k}</MenuItem>
                                )) }
                            </TextField>
                        </p> }

                    { restraints.length === 0
                      ? <div>No restraints currently configured, use the "Create restraint" option on the sequences menu if you wish to use restraints in your prediction</div>
                      : <FormControlLabel
                              control={<Checkbox name="boltz-restraints" checked={useRestraints ?? false} onChange={(ev) => updatePredictionOptions({useRestraints: ev.target.checked})} />}
                              label="Use restraints" /> }
                </React.Fragment>
            );
        };

        return this.runCzekoladaStructurePredictionMSA({
            method: 'boltz-2.2.1',
            methodKey: 'boltz221',
            structureSuffixes,
            inputConstructor: (structureInfo, predictionOptions={}) => {
                const {ligandColumnForAffinity, useRestraints} = predictionOptions
                const {proteinSequences, ligands, dnas, rnas, predictionKey, alignments} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntriesByKey = {};
                const bindEntry = (type, seq, chain, props={}) => {
                    const key = type + '__' + seq;
                    if (!requestEntriesByKey[key]) {
                        requestEntriesByKey[key] = {
                            ...props,
                            type,
                            [type === 'ligand' ? 'smiles' : 'sequence']: seq,
                            id: []
                        };
                    }
                    requestEntriesByKey[key].id.push(chain);
                }
                const affinities = [];


                const columnNameToChain = {};
                const columnNameToGapMap = {};

                (proteinSequences || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[proteinColumns[i]] = chain;
                     if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[proteinColumns[i]] = gapMap;
                    }
                    bindEntry('protein', s, chain, {msa: `msa${chain}.a3m`});
                });
                ligands?.forEach((l, ligandIndex) => {
                    const chain = nextChain();
                    columnNameToChain[ligandColumns[ligandIndex]] = chain;
                    if (ligandColumnKeys[ligandIndex] === ligandColumnForAffinity) {
                        affinities.push(chain);
                    }
                    bindEntry('ligand', l, chain);
                });
                (dnas || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[dnaColumns[i]] = chain;
                     if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[dnaColumns[i]] = gapMap;
                    }
                    bindEntry('dna', s, chain);
                });
                (rnas || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[rnaColumns[i]] = chain;
                     if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[rnaColumns[i]] = gapMap;
                    }
                    bindEntry('rna', s, chain);
                });

                const requestEntries = Object.values(requestEntriesByKey).map(({type, id, ...rest}) => ({[type]: {id: id.length === 1 ? id[0]: id, ...rest}}));
                const request = {sequences: requestEntries};
                if (affinities.length > 0) {
                    request.properties = affinities.map((c) => ({affinity: {binder: c}}));
                }

                if (useRestraints && restraints?.length > 0) {
                    const boltzRestraints = restraints.flatMap(({id, fromSeqCol, fromSeqPos, fromLigand, toSeqCol, toSeqPos, toLigand, minAngstroms, maxAngstroms}) => {
                        const mappedFromPos = (columnNameToGapMap[fromSeqCol] || [])[fromSeqPos],
                              mappedToPos = (columnNameToGapMap[toSeqCol] || [])[toSeqPos];

                        if ((!fromLigand && typeof(mappedFromPos) !== 'number') || (!toLigand && typeof(mappedToPos) !== 'number')) {
                            alert('Problem mapping restraint coordinates');
                            return [];
                        }


                        if (fromLigand) {
                            return [{
                                pocket: {
                                    binder: columnNameToChain[fromSeqCol],
                                    contacts: [[columnNameToChain[toSeqCol], mappedToPos + 1]],
                                    max_distance: maxAngstroms
                                }
                            }];
                        } else if (toLigand) {
                            return [{
                                pocket: {
                                    binder: columnNameToChain[toSeqCol],
                                    contacts: [[columnNameToChain[fromSeqCol], mappedFromPos + 1]],
                                    max_distance: maxAngstroms
                                }
                            }];
                        } else {
                            return ({
                                contact: {
                                    token1: [columnNameToChain[fromSeqCol], mappedFromPos + 1],
                                    token2: [columnNameToChain[toSeqCol], mappedToPos + 1],
                                    max_distance: maxAngstroms
                                }
                            })
                        }
                    });

                    if (boltzRestraints.length > 1) {
                        request.constraints = boltzRestraints;
                    }
                }


                const fasta = new Blob(
                    [JSON.stringify(request, null, 2)],
                    {
                        type: 'application/x-yaml'
                    }
                );

                return {
                    input: fasta,
                    output_format: 'pdb',
                    diffusion_samples: 5
                };
            },
            replacedInputs: ['input'],
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'boltz221';
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'Predicted structure (PDB)', type: 'url', required: true},
                        {label: 'pLDDT arrays', type: 'arrayBuffer', required: false},
                        {label: 'Affinity predictions', type: 'json', required: false}
                    ],
                );

                if (fetchResult) {
                    const plddtArrays = {};
                    for (const r of fetchResult) {
                        if (r.label === 'pLDDT arrays') {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                            const modelMatch = /(model_.+)\.npz$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                const plddt = await parseBoltzPLDDTs(r.data);
                                plddtArrays[modelName] = plddt;
                            }
                        }
                    }

                    for (const r of fetchResult) {
                        if (r.label === 'Affinity predictions') {
                            const {affinity_pred_value, affinity_probability_binary} = r.data;
                            this.props.updateDatum(structureInfo.dataIndices[0], 'boltz_affinity_pred', affinity_pred_value, true, true);
                            this.props.updateDatum(structureInfo.dataIndices[0], 'boltz_pIC50', (6-affinity_pred_value) * 1.364, true, true);
                            this.props.updateDatum(structureInfo.dataIndices[0], 'boltz_binding_probability', affinity_probability_binary, true, true);
                        } else if (r.label === 'Predicted structure (PDB)' /*r.path.endsWith('.pdb')*/) {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                            let plddt = undefined;
                            let predName = '0'
                            const modelMatch = /(model_(.+))\.pdb$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                predName = modelMatch[2]
                                plddt = plddtArrays[modelName];
                            }
                            const structureModelName = jobName + '_' + predName;

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'Boltz-2.2.1',
                                _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                            };
                            if (plddt) {
                                let index = 0;
                                jobResult._gyde_plddts = seqColumns.map(({column}, colIndex) =>  {
                                    if ((columnTypes[column] ?? 'protein') === 'protein') {
                                        const p = [];
                                        for (let i = 0; i < sequences[colIndex].length; ++i) {
                                            p.push(plddt[index++])
                                        }
                                        return p;
                                    } else {
                                        return;
                                    }
                                });
                            }

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                structureModelName,
                                structureModelName === jobName + structureSuffixes[0]
                            );
                        }
                    }

                    this.props.setVisibleStructures([jobName + structureSuffixes[0]]);
                    this.props.setStructureColorScheme('pLDDT');
                }
            },
            reconnect: reconnect,
            hideParams: ['input', 'output_format', 'msa'],
            constrainParams: undefined,
            message: <LC4AWidget />
        });
    }


    runOF3Prediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService, restraints=[]} = this.props;
        const ligandColumns = Object.entries(this.props.columnTypes).filter(([_, type]) => type === 'smiles').map(([col, _]) => col);
        const structureSuffixes = ['_1', '_2', '_3', '_4', '_5'];

        const ligandColumnKeys = Object.entries(this.props.columnTypes || {}).filter(([k, v]) => v === 'smiles').map(([k, v]) => k)

        return this.runCzekoladaStructurePredictionMSA({
            method: 'openfold3-dev-Aug22',
            methodKey: 'of3',
            structureSuffixes,
            inputConstructor: (structureInfo, predictionOptions={}) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey, alignments} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntriesByKey = {};

                const bindEntry = (type, seq, chain, props={}) => {
                    const key = type + '__' + seq;
                    if (!requestEntriesByKey[key]) {
                        requestEntriesByKey[key] = {
                            ...props,
                            molecule_type: type,
                            [type === 'ligand' ? 'smiles' : 'sequence']: seq,
                            chain_ids: []
                        };
                    }
                    requestEntriesByKey[key].chain_ids.push(chain);
                }

                const columnNameToChain = {};
                const columnNameToGapMap = {};
                const proteinChains = [];

                (proteinSequences || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[seqColumns[i].column] = chain;
                     if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[seqColumns[i].column] = gapMap;
                    }
                    bindEntry(
                        'protein',
                        s,
                        chain,
                        {
                            main_msa_file_paths: [`msa${chain}.a3m`]
                        }
                    );
                    proteinChains.push(chain);
                });
                ligands?.forEach((l, ligandIndex) => {
                    const chain = nextChain();
                    columnNameToChain[ligandColumns[ligandIndex]] = chain;
                    bindEntry('ligand', l, chain);
                });
                for (const d of (dnas || [])) {
                    bindEntry('dna', d, nextChain());
                }
                for (const r of (rnas || [])) {
                    bindEntry('rna', r, nextChain());
                }

                const requestEntries = Object.values(requestEntriesByKey); /*.map(({chain_ids: id, ...rest}) => ({chain_ids: id.length === 1 ? id[0]: id, ...rest})) */;
                const request = {
                    queries: {
                        query_1: {
                            chains: requestEntries,
                            use_msas: true,
                            use_main_msas: true,
                            use_paired_msas: false
                        }
                    }
                };

                const msas = proteinChains.map((c) => `msa${c}`)
                const runnerConfig = {
                    pl_trainer_args: {
                      devices: 1,
                      num_nodes: 1
                    },

                    output_writer_settings: {
                      structure_format: 'pdb'
                    },

                    msa_computation_settings: {
                      msa_output_directory: 'of3_local_msa',
                      cleanup_msa_dir: false,
                      save_mappings: true,
                    },

                    dataset_config_kwargs: {
                        msa: {
                            max_seq_counts: Object.fromEntries(msas.map((c) => [c, 50000])),
                            msas_to_pair: [],
                            aln_order: msas
                        }
                    }
                }

                const query = new Blob(
                    [JSON.stringify(request, null, 2)],
                    {
                        type: 'application/json'
                    }
                );

                const runner_yaml = new Blob(
                    [JSON.stringify(runnerConfig, null, 2)],
                    {
                        type: 'application/json'
                    }
                );

                return {
                    query,
                    runner_yaml
                };
            },
            replacedInputs: ['query', 'runner_yaml'],
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'of3'
                const structureName = jobName + structureSuffixes[0];
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'All predicted structures (PDB)', type: 'url', required: true},
                        {label: 'pLDDT arrays', type: 'arrayBuffer', required: false},
                        {label: 'Affinity predictions', type: 'json', required: false}
                    ],
                );

                if (fetchResult) {
                    for (const r of fetchResult) {
                        if (r.label === 'All predicted structures (PDB)' /*r.path.endsWith('.pdb')*/) {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                            let predName = '1'
                            const modelMatch = /.*(sample_(.+)_model)\.pdb$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                predName = modelMatch[2]
                            }
                            const structureModelName = jobName + '_' + predName;

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'OpenFold-3',
                                _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                            };

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                structureModelName,
                                structureModelName === structureName
                            );
                        }
                    }

                    this.props.setVisibleStructures([structureName]);
                    this.props.setStructureColorScheme('pLDDT');
                }
            },
            reconnect: reconnect,
            hideParams: ['query', 'msa', 'runner_yaml'],
            constrainParams: undefined,
            skipValidationParams: ['msa'],
            message: 'OpenFold-3 is a work-in-progress, and is currently using a partially-trained version of the model'
        });
    }

    runOF3V1Prediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService, restraints=[]} = this.props;
        const ligandColumns = Object.entries(this.props.columnTypes).filter(([_, type]) => type === 'smiles').map(([col, _]) => col);
        const structureSuffixes = ['_1', '_2', '_3', '_4', '_5'];

        const ligandColumnKeys = Object.entries(this.props.columnTypes || {}).filter(([k, v]) => v === 'smiles').map(([k, v]) => k)

        return this.runCzekoladaStructurePredictionMSA({
            method: 'openfold3-v1',
            methodKey: 'of3v1',
            structureSuffixes,
            inputConstructor: (structureInfo, predictionOptions={}) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey, alignments} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntriesByKey = {};

                const bindEntry = (type, seq, chain, props={}) => {
                    const key = type + '__' + seq;
                    if (!requestEntriesByKey[key]) {
                        requestEntriesByKey[key] = {
                            ...props,
                            molecule_type: type,
                            [type === 'ligand' ? 'smiles' : 'sequence']: seq,
                            chain_ids: []
                        };
                    }
                    requestEntriesByKey[key].chain_ids.push(chain);
                }

                const columnNameToChain = {};
                const columnNameToGapMap = {};
                const proteinChains = [];

                (proteinSequences || []).forEach((s, i) => {
                    const chain = nextChain();
                    columnNameToChain[seqColumns[i].column] = chain;
                     if (alignments[i]) {
                        const gapMap = [];
                        let cursor = 0;
                        for (let a = 0; a < alignments[i].length; ++a) {
                            if (alignments[i][a] !== '-') {
                                gapMap[a] = cursor++;
                            }
                        }
                        columnNameToGapMap[seqColumns[i].column] = gapMap;
                    }
                    bindEntry(
                        'protein',
                        s,
                        chain,
                        {
                            main_msa_file_paths: [`msa${chain}.a3m`]
                        }
                    );
                    proteinChains.push(chain);
                });
                ligands?.forEach((l, ligandIndex) => {
                    const chain = nextChain();
                    columnNameToChain[ligandColumns[ligandIndex]] = chain;
                    bindEntry('ligand', l, chain);
                });
                for (const d of (dnas || [])) {
                    bindEntry('dna', d, nextChain());
                }
                for (const r of (rnas || [])) {
                    bindEntry('rna', r, nextChain());
                }

                const requestEntries = Object.values(requestEntriesByKey); /*.map(({chain_ids: id, ...rest}) => ({chain_ids: id.length === 1 ? id[0]: id, ...rest})) */;
                const request = {
                    queries: {
                        query_1: {
                            chains: requestEntries,
                            use_msas: true,
                            use_main_msas: true,
                            use_paired_msas: false
                        }
                    }
                };

                const msas = proteinChains.map((c) => `msa${c}`)
                const runnerConfig = {
                    model_update: {
                        presets: ['predict', 'pae_enabled']
                    },

                    pl_trainer_args: {
                      devices: 1,
                      num_nodes: 1
                    },

                    output_writer_settings: {
                      structure_format: 'pdb'
                    },

                    msa_computation_settings: {
                      msa_output_directory: 'of3_local_msa',
                      cleanup_msa_dir: false,
                      save_mappings: true,
                    },

                    dataset_config_kwargs: {
                        msa: {
                            max_seq_counts: Object.fromEntries(msas.map((c) => [c, 50000])),
                            msas_to_pair: [],
                            aln_order: msas
                        }
                    }
                }

                const query = new Blob(
                    [JSON.stringify(request, null, 2)],
                    {
                        type: 'application/json'
                    }
                );

                const runner_yaml = new Blob(
                    [JSON.stringify(runnerConfig, null, 2)],
                    {
                        type: 'application/json'
                    }
                );

                return {
                    query,
                    runner_yaml
                };
            },
            replacedInputs: ['query', 'runner_yaml'],
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'of3v1';
                const structureName = jobName + structureSuffixes[0];
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'All predicted structures (PDB)', type: 'url', required: true},
                        {label: 'pLDDT arrays', type: 'arrayBuffer', required: false},
                        {label: 'Affinity predictions', type: 'json', required: false}
                    ],
                );

                if (fetchResult) {
                    for (const r of fetchResult) {
                        if (r.label === 'All predicted structures (PDB)' /*r.path.endsWith('.pdb')*/) {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                            let predName = '1'
                            const modelMatch = /.*(sample_(.+)_model)\.pdb$/.exec(fileName);
                            if (modelMatch) {
                                const modelName = modelMatch[1];
                                predName = modelMatch[2]
                            }
                            const structureModelName = jobName + '_' + predName;

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'OpenFold-3 v1',
                                _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                            };

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                structureModelName,
                                structureModelName === structureName
                            );
                        }
                    }

                    this.props.setVisibleStructures([structureName]);
                    this.props.setStructureColorScheme('pLDDT');
                }
            },
            reconnect: reconnect,
            hideParams: ['query', 'msa', 'runner_yaml'],
            constrainParams: undefined,
            skipValidationParams: ['msa'],
            message: 'Confidence scores for OpenFold-3 are still considered Beta quality (Kiran check?)'
        });
    }

    runOF3VNimPrediction(reconnect=false) {
        const {seqColumns, columnTypes, restraints=[]} = this.props;
        const ligandColumns = Object.entries(this.props.columnTypes).filter(([_, type]) => type === 'smiles').map(([col, _]) => col);

        const ligandColumnKeys = Object.entries(this.props.columnTypes || {}).filter(([k, v]) => v === 'smiles').map(([k, v]) => k)

        return this.runNimStructurePredictionMSA({
            method: 'openfold3',
            methodKey: 'of3nim',
            endpoint: '/v1/biology/openfold/openfold3/predict',
            inputConstructor: (structureInfo, msaDict) => {
                const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;
                let chainSeed = 0;
                const nextChain = () => String.fromCharCode(65+(chainSeed++));
                const requestEntriesByKey = {};

                const bindEntry = (type, seq, chain, props={}) => {
                    const key = type + '__' + seq + '__' + chain;
                    if (!requestEntriesByKey[key]) {
                        requestEntriesByKey[key] = {
                            ...props,
                            type: type,
                            [type === 'ligand' ? 'smiles' : 'sequence']: seq,
                            id: chain       // can we actually re-use chains with the NIM API?
                        };
                    }
                    // requestEntriesByKey[key].chain_ids.push(chain);
                }

                const columnNameToChain = {};
                const columnNameToGapMap = {};
                const proteinChains = [];

                (proteinSequences || []).forEach((s, i) => {
                    const chain = nextChain();
                    const msa = msaDict[s];
                    bindEntry(
                        'protein',
                        s,
                        chain,
                        {
                            msa: {
                                main_db: {
                                    a3m: {
                                        alignment: msa,
                                        format: 'a3m'
                                    }
                                }
                            }
                        }
                    );
                    proteinChains.push(chain);
                });
                ligands?.forEach((l, ligandIndex) => {
                    const chain = nextChain();
                    columnNameToChain[ligandColumns[ligandIndex]] = chain;
                    bindEntry('ligand', l, chain);
                });
                for (const d of (dnas || [])) {
                    bindEntry('dna', d, nextChain());
                }
                for (const r of (rnas || [])) {
                    bindEntry('rna', r, nextChain());
                }

                const requestEntries = Object.values(requestEntriesByKey); /*.map(({chain_ids: id, ...rest}) => ({chain_ids: id.length === 1 ? id[0]: id, ...rest})) */;
                const request = {
                    molecules: requestEntries
                };

                return {
                    request_id: 'gyde-structure',
                    inputs: [{
                        input_id: 'gyde0',
                        ...request,
                        output_format: 'pdb'
                    }]
                };
            },
            onComplete: async (result, structureInfo) => {
                const jobName = 'of3nim';
                const structureName = jobName;
                const structureModelName = structureName;
                const sequences = structureInfo.sequences;

                console.log(result);
                const struct = result.outputs[0].structures_with_scores[0].structure;
                const structBlob = new Blob([struct], {type: 'chemical/x-pdb'});
                structBlob._gyde_analysis = 'success';
                structBlob._gyde_method = 'OpenFold-3 v1';
                structBlob._gyde_chains = this.getProteinChainLetters(seqColumns, columnTypes);

                /*
                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'OpenFold-3 v1',
                                _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                            };
                */

                this.props.addValueToNewStructureColumn(
                    structureInfo.dataIndices[0],
                    structBlob,
                    structureModelName,
                    structureModelName === structureName
                );

                this.props.setVisibleStructures([structureName]);
                this.props.setStructureColorScheme('pLDDT');
            },
            reconnect: reconnect,
            message: 'Confidence scores for OpenFold-3 are still considered Beta quality (Kiran check?)'
        });
    }

    runChaiPrediction(probeOnly=false, reconnect=false) {
        const methodKey = 'chai';

        probeOnly = probeOnly || reconnect;
        const {selection, columnarData, seqColumns, columnTypes, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting Chai structures takes a long time -- potentially >10 minutes for large complexes.  Proceed?';
        if (structureInfos.length > 20 && !probeOnly) {
            alert('We currently do not allow Chai-1 to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
            return;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach(async (structureInfo) => {
            const structureName = 'chai_0';
            
            const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;

            if ((this.state.predictionsPending[methodKey] || {})[predictionKey]) {
                if (!probeOnly) console.log('Prediction already running');
                return;
            }

            let chainSeed = 0;
            const nextChain = () => String.fromCharCode(65+(chainSeed++));
            const requestEntries = [];

            for (const s of proteinSequences) {
                requestEntries.push(`>protein|name=${nextChain()}\n${s}`);
            }
            for (const l of (ligands || [])) {
                requestEntries.push(`>ligand|name=${nextChain()}\n${l}`);
            }
            for (const d of (dnas || [])) {
                requestEntries.push(`>dna|name=${nextChain()}\n${d}`);
            }
            for (const r of (rnas || [])) {
                requestEntries.push(`>rna|name=${nextChain()}\n${r}`);
            }

            const fasta = new Blob(
                [requestEntries.join('\n')],
                {
                    type: 'application/fasta'
                }
            );

            const formData = new FormData();
            formData.append('input', fasta, 'input.fa');

            const oldStructureRecord = (columnarData[structureName] || [])[structureInfo.dataIndices[0]],
                  pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                  pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined;

            if (!pending && reconnect) return;

            this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, true));

            if (!probeOnly) {
                this.props.pinger('analysis.chai')
            }

            let firstPing = true;
            const listener = async (result) => {
                if (result.finished || !result.id) {
                    if (result.status === 'COMPLETED') {
                        const fetchResult = await slivkaService.fetch(
                            result.id,
                            [
                                {label: 'Predicted structure (CIF)', type: 'url', required: true},
                            ],
                        );

                        if (fetchResult) {
                            for (const r of fetchResult) {
                                if (r.label === 'Predicted structure (CIF)') {
                                    const splitPath = r.path.split('/');
                                    const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                                    const predName = fileName.replace('pred.model_idx_', '').replace('.cif', '');
                                    const structureModelName = 'chai_' + predName;
                                    this.props.addValueToNewStructureColumn(
                                        structureInfo.dataIndices[0],
                                        {
                                            _gyde_analysis: 'success',
                                            _gyde_job_url: result['@url'],
                                            _gyde_url: r.data,
                                            _gyde_method: 'Chai-1',
                                            _gyde_type: 'chemical/x-mmcif',
                                            _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                                        },
                                        structureModelName,
                                        structureModelName === structureName
                                    );
                                }
                            }

                            this.props.setVisibleStructures([structureName]);
                            this.props.setStructureColorScheme('pLDDT');
                        }
                    } else {
                        if (pending || !probeOnly) {
                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                {_gyde_analysis: 'error', _gyde_message: ('Chai-1 status ' + result.status) || 'SUBMIT_FAILED', _gyde_job_url: result['@url']},
                                structureName
                            );
                        }
                    }

                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
                } else {
                    if (firstPing) {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {_gyde_analysis: 'pending', _gyde_job_id: result.id, _gyde_job_url: result['@url']},
                            structureName
                        );
                        firstPing = false;
                    }
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null /* no update */));
                }
            };

            if (pending) {
                this.slivkaSubscriptions.push(slivkaService.watchJob(pending, listener, pendingURL));
            } else {
                const ss = await slivkaService.submit(
                    'chai-1',
                    formData,
                    {useCache: probeOnly ? 'probe' : true},
                    listener
                );
                this.slivkaSubscriptions.push(ss);
            }
        });
    }

    runChaiMSAPrediction(probeOnly=false, reconnect=false) {
        const methodKey = 'chai-msa';

        probeOnly = probeOnly || reconnect;
        const {selection, columnarData, seqColumns, columnTypes, slivkaService, structureSequence, visibleStructures, isAntibody} = this.props;
        const structureInfos = this.extractStructuresFromSelection(
            columnarData, seqColumns, this.props.seqRefColumns, this.props.alignments, this.props.references,
            reconnect ? true : selection, this.props.columnTypes, structureSequence, visibleStructures, isAntibody, this.state.mappingCache
        );
        
        let msg = 'Predicting Chai structures takes a long time -- potentially hours for large complexes.  Proceed?';
        if (structureInfos.length > 20 && !probeOnly) {
            alert('We currently do not allow Chai-1 to be run on more than 20 sequences in a single operation, contact CSB if you think you need this');
            return;
        }

        if (!probeOnly && !window.confirm(msg)) return;

        structureInfos.forEach(async (structureInfo) => {
            const structureName = 'chai_msa_0';
            const statusKey = 'chaiMSAPredictionStatus', pendingKey = 'chaiMSAPredictionPending';
            const {proteinSequences, ligands, dnas, rnas, predictionKey} = structureInfo;

            if ((this.state.predictionsPending[methodKey] || {})[predictionKey]) {
                if (!probeOnly) console.log('Prediction already running');
                return;
            }

            let chainSeed = 0;
            const nextChain = () => String.fromCharCode(65+(chainSeed++));
            const requestEntries = [];

            for (const s of proteinSequences) {
                requestEntries.push(`>protein|name=${nextChain()}\n${s}`);
            }
            for (const l of (ligands || [])) {
                requestEntries.push(`>ligand|name=${nextChain()}\n${l}`);
            }
            for (const d of (dnas || [])) {
                requestEntries.push(`>dna|name=${nextChain()}\n${d}`);
            }
            for (const r of (rnas || [])) {
                requestEntries.push(`>rna|name=${nextChain()}\n${r}`);
            }

            const fasta = new Blob(
                [requestEntries.join('\n')],
                {
                    type: 'application/fasta'
                }
            );

            const formData = new FormData();
            formData.append('input', fasta, 'input.fa');

            const oldStructureRecord = (columnarData[structureName] || [])[structureInfo.dataIndices[0]],
                  pending = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_id : undefined,
                  pendingURL = oldStructureRecord?._gyde_analysis === 'pending' ? oldStructureRecord?._gyde_job_url : undefined;

            if (!pending && reconnect) return;

            this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, true));

            if (!probeOnly) {
                this.props.pinger('analysis.chai')
            }

            let firstPing = true;
            const listener = async (result) => {
                if (result.finished || !result.id) {
                    if (result.status === 'COMPLETED') {
                        const fetchResult = await slivkaService.fetch(
                            result.id,
                            [
                                {label: 'Predicted structure (CIF)', type: 'url', required: true},
                            ],
                        );

                        if (fetchResult) {
                            for (const r of fetchResult) {
                                if (r.label === 'Predicted structure (CIF)') {
                                    const splitPath = r.path.split('/');
                                    const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                                    const predName = fileName.replace('pred.model_idx_', '').replace('.cif', '');
                                    const structureModelName = 'chai_msa_' + predName;
                                    this.props.addValueToNewStructureColumn(
                                        structureInfo.dataIndices[0],
                                        {
                                            _gyde_analysis: 'success',
                                            _gyde_job_url: result['@url'],
                                            _gyde_url: r.data,
                                            _gyde_method: 'Chai-1+MSA',
                                            _gyde_type: 'chemical/x-mmcif',
                                            _gyde_chains: this.getProteinChainLetters(seqColumns, columnTypes)
                                        },
                                        structureModelName,
                                        structureModelName === structureName
                                    );
                                }
                            }

                            this.props.setVisibleStructures([structureName]);
                            this.props.setStructureColorScheme('pLDDT');
                        }
                    } else {
                        if (pending || !probeOnly) {
                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                {_gyde_analysis: 'error', _gyde_message: ('Chai-1 status ' + result.status) || 'SUBMIT_FAILED', _gyde_job_url: result['@url']},
                                structureName
                            );
                        }
                    }

                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, undefined, false));
                } else {
                    if (firstPing) {
                        this.props.addValueToNewStructureColumn(
                            structureInfo.dataIndices[0],
                            {_gyde_analysis: 'pending', _gyde_job_id: result.id, _gyde_job_url: result['@url']},
                            structureName
                        );
                        firstPing = false;
                    }
                    this.setState((oldState) => updatePredictionsState(oldState, methodKey, predictionKey, result.status, null /* no update */));
                }
            };

            if (pending) {
                this.slivkaSubscriptions.push(slivkaService.watchJob(pending, listener, pendingURL));
            } else {
                const ss = await slivkaService.submit(
                    'chai-1-collabfold-msa',
                    formData,
                    {useCache: probeOnly ? 'probe' : true},
                    listener
                );
                this.slivkaSubscriptions.push(ss);
            }
        });
    }


    prepareIbexLikeData(structureInfo, name='Ibex') {
        if (this.props.alignmentKey !== 'anarciSeqs') {
            throw Error(`${name} only runs in Antibody-aligned mode.`)
        }

        const hcIndex = this.props.seqColumns.findIndex((c) => c.column === this.props.hcColumn),
              lcIndex = this.props.seqColumns.findIndex((c) => c.column === this.props.lcColumn),
              hcAli = (structureInfo.alignments || [])[hcIndex],
              lcAli = (structureInfo.alignments || [])[lcIndex];

        if (!hcAli || !lcAli) {
            throw Error('Antibody alignments not available');
        }

        return {
            'fv-light': lcAli.replace(/-/g, ''),
            'fv-heavy': hcAli.replace(/-/g, '')
        };
    }

    runIbexPrediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService} = this.props;

        return this.runCzekoladaStructurePredictionProps({
            method: 'ibex',
            methodKey: 'ibex',
            inputConstructor: (structureInfo) => {
                return this.prepareIbexLikeData(structureInfo);
            },
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'ibex';
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'Predicted structure (PDB)', type: 'url', required: true},
                    ],
                );

                if (fetchResult) {
                    for (const r of fetchResult) {
                        if (r.label === 'Predicted structure (PDB)') {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;
                            const structureModelName = 'ibex';

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'Ibex',
                                _gyde_chains: ['H', 'L']
                            };

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                jobName,
                                true
                            );
                        }
                    }

                    this.props.setVisibleStructures([jobName]);
                }
            },
            reconnect: reconnect,
            hideParams: ['fv-light', 'fv-heavy', 'csv', 'parquet', 'batch-size'],
            constrainParams: undefined,
        });
    }

    runABodyBuilder3Prediction(reconnect=false) {
        const {seqColumns, columnTypes, slivkaService} = this.props;

        return this.runCzekoladaStructurePredictionProps({
            method: 'abodybuilder3',
            methodKey: 'abb3',
            inputConstructor: (structureInfo) => {
                return this.prepareIbexLikeData(structureInfo, 'ABodyBuilder3');
            },
            onComplete: async (result) => {
                const jobName = result.jobName ?? 'abb3';
                const structureInfo = result.structureInfo;
                const sequences = structureInfo.sequences;
                const fetchResult = await slivkaService.fetch(
                    result.id,
                    [
                        {label: 'Predicted structure (PDB)', type: 'url', required: true},
                    ],
                );

                if (fetchResult) {
                    for (const r of fetchResult) {
                        if (r.label === 'Predicted structure (PDB)') {
                            const splitPath = r.path.split('/');
                            const fileName = splitPath.length ? splitPath[splitPath.length - 1] : undefined;

                            const jobResult = {
                                _gyde_analysis: 'success',
                                _gyde_job_url: result['@url'],
                                _gyde_url: r.data,
                                _gyde_method: 'ABodyBuilder3',
                                _gyde_chains: ['H', 'L']
                            };

                            this.props.addValueToNewStructureColumn(
                                structureInfo.dataIndices[0],
                                jobResult,
                                jobName,
                                true
                            );
                        }
                    }

                    this.props.setVisibleStructures([jobName]);
                }
            },
            reconnect: reconnect,
            hideParams: ['fv-light', 'fv-heavy', 'csv', 'parquet', 'batch-size'],
            constrainParams: undefined,
        });
    }

    onMolstarSelectionChange(selectionChanges, atomicMappingsTree) {
        if (this.updatingSelection) {
            return;
        }

        const { seqColumns, isAntibody } = this.props;
        if (this.state.loading) return;

        const entries = Object.entries(selectionChanges);
        if (entries.length === 0) return;

        const [structureLabel, selectedResidues] = entries[0];

        const structureInfo = this.structureInfos.filter((si) => si.structureLabel === structureLabel)[0];
        if (!structureInfo) {
            console.log('*** No structureinfo');
            return;
        }

        const atomicMappings = atomicMappingsTree[structureLabel];
        if (!atomicMappings) {
            console.log('*** Unable to find atomicMappings for ', structureLabel);
            return;
        }

        let chains = structureInfo.explicitChains;
        if (!chains && isAntibody) {
            chains = new Array(seqColumns.length);
            
            seqColumns.forEach(({column}, index) => {
                if (column === this.props.hcColumn) {
                    chains[index] = 'H';
                } else if (column === this.props.lcColumn) {
                    chains[index] = 'L';
                }
            });
        }
        if (!chains) return;

        const chainToIndex = {};
        chains.forEach((c, i) => {
            for (const cn of c.split(',')) {
                chainToIndex[cn] = i;
            }
        });

        const mappings = structureInfo.explicitMappings;
        const reverseMappings = mappings?.map((m) => {
            const reverseMapping = {};
            m.forEach((mm, i) => {
                const rn = mm?.value?.residueNumber;
                if (rn) reverseMapping[rn] = i;
            });
            return reverseMapping
        });

        let reverseMappingsByChain;
        if (!reverseMappings) {
            reverseMappingsByChain = {};
            Object.entries(atomicMappings).forEach(([chainName, mapping]) => {
                const reverseMapping = {};
                mapping.forEach((mm, i) => {
                    const rn = mm?.value?.residueNumber;
                    if (rn) reverseMapping[rn] = i;
                });
                reverseMappingsByChain[chainName] = reverseMapping;
            });
        }

        const gapMap = structureInfo.alignments.map((a) => {
            const gm = []
            for (let i = 0; i < a.length; ++i) {
                if (a[i] !== '-') gm.push(i);
            }
            return  gm;
        });

        const seqColumnSelections = seqColumns.map(() => new Set());
        for (const [chain, msSel] of Object.entries(selectedResidues)) {
            const index = chainToIndex[chain];
            if (index !== undefined) {
                for (const si of msSel) {
                    const sis = si.toString();
                    if (reverseMappings) {
                        if (sis in reverseMappings[index]) {
                            seqColumnSelections[index].add(gapMap[index][reverseMappings[index][sis]]);
                        }
                    } else if (reverseMappingsByChain && reverseMappingsByChain[chain]) {
                        if (sis in reverseMappingsByChain[chain]) {
                            seqColumnSelections[index].add(gapMap[index][reverseMappingsByChain[chain][sis]]);
                        }
                    }
                }
            }
        }

        seqColumnSelections.forEach((sel, index) => {
            if (this.props.updateSelectedColumns) {
                this.props.updateSelectedColumns(seqColumns[index].column, {op: 'set', column: sel});
            }
        });
    }
}

export default withResizeDetector(forwardRef((props, ref) => (
    <EnvironmentContext.Consumer>
        { (environment) => (
            <TokenContext.Consumer>
                { (token) => (
                    <PingerContext.Consumer>
                        { (pinger) => (
                            <SlivkaServiceContext.Consumer>
                                { (slivkaService) => (
                                    <GydeWorkerServiceContext.Consumer>
                                        { (gydeWorkerService) => (
                                            <StructureHolder {...props} 
                                                             slivkaService={slivkaService}
                                                             pinger={pinger} 
                                                             tokenService={token}
                                                             environment={environment}
                                                             gydeWorkerService={gydeWorkerService}
                                                             ref={ref} />) }
                                    </GydeWorkerServiceContext.Consumer>
                                ) }
                            </SlivkaServiceContext.Consumer>
                        ) }
                    </PingerContext.Consumer>
                ) }
            </TokenContext.Consumer>
        ) }
    </EnvironmentContext.Consumer>
)));
