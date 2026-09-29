import React, {useMemo, useEffect, useCallback} from 'react';

import {csvParse} from 'd3-dsv';

import {BrowserRouter, Routes, Route, Navigate, useParams, useNavigate} from 'react-router';

import Homepage from './Homepage.js';
import TabView from './TabView';
import {LogoPage} from './Landingpage';

import { Dialog, DialogTitle } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles'
import gtheme from './theme'

import { absolveProtZoo, absolveProtPid, anarci } from './analysis/alignment.js';
import { loadSpreadsheet, convertToJson } from './utils/loaders.js';
import { makeSaveableTabState, hydrateTabState } from './session.js';
import { HeatmapData } from './gmsa/HeatmapUtils.js';
import { LAYOUT, STRUCTURE_KEYS } from './utils/constants.js';

import {SlivkaServiceContext} from './czekolada/lib';
import memoize from 'memoize-one';
import {isTamarindCompute} from './compute';
import {requestError} from './czekolada/requestErrors';

export class _App extends React.Component {
    static defaultProps = {
        // in "Kabat" numbers.  Kabat definition from http://www.bioinf.org.uk/abs/info.html
        cdrPos: {
            'L1': {start: 'L24', stop: 'L34', color: '#ffc04c' /*'orange'*/},
            'L2': {start: 'L50', stop: 'L56', color: 'yellow'},
            'L3': {start: 'L89', stop: 'L97', color: 'lightgreen'},
            'H1x': {start: 'H26', stop: 'H30', color: '#e4bfbf', label: ''},
            'H1': {start: 'H31', stop: 'H35B', color: '#c97f7f' /*'brown'*/},
            'H2': {start: 'H50', stop: 'H65', color: '#ff6666', /*'red'*/},
            'H3x': {start: 'H93', stop: 'H94', color: '#b399ff', label: ''},
            'H3': {start: 'H95', stop: 'H102', color: '#6666ff' /*'blue' */}
        },

        // in "Kabat" numbers.  Taken from AbGrafter
        vernierPos: [
            "L2",
            "L4",
            "L35",
            "L36",
            "L38",
            "L43",
            "L44",
            "L46",
            "L36",
            "L38",
            "L43",
            "L44",
            "L46",
            "L47",
            "L48",
            "L49",
            "L58",
            "L64",
            "L66",
            "L68",
            "L69",
            "L71",
            "L87",
            "L98",

            "H2",
            "H24",
            "H37",
            "H39",
            "H45",
            "H47",
            "H48",
            "H49",
            "H67",
            "H69",
            "H71",
            "H73",
            "H75",
            "H76",
            "H78",
            "H91",
            "H103",
            "H105"
        ],

        columnDefsURL: '/GYDE_Documentation.csv',

        // These columns are always hidden, and not available in the column picker UI either.
        hideColumns: new Set([
            'HC_sequence',
            'LC_sequence',
            'merge_seqid',
            'seed_seqid',
            'HeavyAA',
            'LightAA',
            'seed_LightAA',
            'seed_HeavyAA',

            'seed_HC_alignment',
            'seed_LC_alignment',
            'seed_HC_sequence',
            'seed_LC_sequence',

            // These are objects associated with the TAP plots, and can't be rendered
            'graph_cdrlen',
            'graph_pnc',
            'graph_ppc',
            'graph_psh',
            'graph_sfvcsp',

            '_structure_cache_type',
            '__candidate_for_mpnn',
            'structure_residue_numbering'
        ]),

        alignmentTargets: [
            ...(isTamarindCompute() ? [{
                name: 'ANARCI',
                aligner: (service, sequences, options) => anarci(service, sequences, 'kabat', options),
                gateOnService: 'anarci',
                numberingOnly: true,
            }] : []),
            /*
            {
                name: 'Human (score)',
                aligner: absolveProt,
                gateOnService: 'absolve-prot'
            },
            */
            {
                name: 'Human',
                aligner: absolveProtPid,
                gateOnService: 'absolve-prot'
            },
            {
                name: 'Zoo',
                aligner: absolveProtZoo,
                gateOnService: 'absolve-zoo'
            }
        ]
    }

    constructor(props) {
        super(props);

        this.tabNameSeed = 0;

        this.state = {
            tabs: [],
            selectedTab: 'olddata',
            selectedOption: null,
            home: true,

            transitionID: 0, // number of last tab-state transition, for checking save status
            tabLastTransition: {},
            tabLastDataTransition: {},
            tabLastSave: {},
            tabLastDataSave: {},
            tabDirtyDataKeys: {},

            savingTab: {},
            savingErrors: {},

            loadingSession: false,
            loadFailures: {}
        }

        this.saving = false;
        this.loadingWorkspaces = new Set();
        this.deletingWorkspaces = new Set();
        this.deletedWorkspaces = new Set();

        this.onDataLoad = this.onDataLoad.bind(this);
        this.loadHistory = this.loadHistory.bind(this);
        this.loadHistoricalSession = this.loadHistoricalSession.bind(this);
        this.switchToHistoricalSession = this.switchToHistoricalSession.bind(this);
        this.deleteHistoricalSession = this.deleteHistoricalSession.bind(this);
        this.updateShareFlag = this.updateShareFlag.bind(this);
        this.updateDescription = this.updateDescription.bind(this);
        this.updateName = this.updateName.bind(this);
        this.makeCopy = this.makeCopy.bind(this);
    }

    newTabState(props) {
        const id = 'tab' + (++this.tabNameSeed),
              data = props.data || [],
              columns = data.columns || props.dataColumns || Object.keys(props.columnarData || {});

        const columnDefs = this.state.columnDefs || [];
        const hideColumns = new Set([...this.props.hideColumns, ...props.hideColumns || []]);
        const columnDefsByName = {};
        for (const c of columnDefs) {
            columnDefsByName[c.descriptor] = c;
        }

        const dataFields = [];
        for (const c of columns) {
            if (columnDefsByName[c]?.showByDefault) {
                dataFields.push(c);
            }
        }

        for (const c of columns) {
            if (dataFields.length < 7 && dataFields.indexOf(c) < 0 && !hideColumns.has(c)) dataFields.push(c);
        }

        const plots = [];
        if (columns.indexOf('yield') >= 0 && columns.indexOf('pKD') >=  0) {
            plots.push({
                    axis1: {
                        series: 'yield'
                    },
                    axis2: {
                        series: 'pKD',
                    }
            });
        } else {
            plots.push({});
        }

        let rowIDSeed = props.rowIDSeed || 0;
        const columnarData = {...(props.columnarData || {})};

        const seqColumns = props.seqColumns?.map((c) => typeof(c) === 'string' ? {column: c} : c) || [];
        let dataRowCount = props.dataRowCount;
        if (dataRowCount === undefined) {
            dataRowCount = columns.map((c) => props.columnarData[c]?.length || 0).reduce((a, b) => Math.max(a, b), 0);
        }

        if (!columnarData._gyde_rowid || columnarData._gyde_rowid.length < dataRowCount) {
            const rid = [...(columnarData._gyde_rowid || [])];
            for (let i = 0; i < dataRowCount; ++i) {
                if (!rid[i]) {
                    rid[i] = `r${rowIDSeed++}`;
                }
            }
            columnarData._gyde_rowid = rid;
            if (columns.indexOf('_gyde_rowid') < 0) {
                columns.push('_gyde_rowid');
            }

            if (!columnarData._gyde_rowid) {
                props = {
                    ...props,
                    selection: props.selection ? new Set(Array.from(props.selection).map((s) => rid[s])) : undefined
                };
            }
        }

        const heatmapDataObject = {};
        seqColumns.forEach((col) => heatmapDataObject[col.column] = new HeatmapData());

        let refNameColumn = props.refNameColumn || 'seed';
        const hasSeeds = columns.indexOf(refNameColumn) >= 0;
        const isAntibody = props.isAntibody ?? true;
        const hasDatasetReference=(props.seqRefColumns || []).map((c) => (c && c.column) ? columnarData[c.column] : undefined).filter((x) => x).length > 0;

        const state = {
            alignmentKey: (props.isAntibody ?? true) ? 'anarciSeqs': 'alignedSeqs',

            plotControlMode: 'select',
            plots: plots,
            plotRows: 1,
            plotCols: Math.max(1, plots.length),
            layout: [...LAYOUT],

            msaDataFields: (props.isAntibody === false) 
                ? ['Names'] 
                : (columns.indexOf('seed') < 0 
                    ? ['Names',
                       'seqid', 
                       ...(seqColumns.findIndex(({column}) => column === 'HC_sequence') >= 0 ? ['lineage_light'] : []),
                       ...(seqColumns.findIndex(({column}) => column === 'LC_sequence') >= 0 ? ['lineage_heavy'] : [])] 
                    : ['Names', 'seqid', 'seed']),
            dataFields: ['Names', ...dataFields], 
            sortField: columns.indexOf('seed') >= 0 ? 'seed' : null,
            
            typefaceName: 'Inconsolata',
            colourSchemeKey: (isAntibody || hasSeeds || hasDatasetReference) ? 'Diffs. to master seq. (invert)' : 'Mae',
            highlightCDRs: false,
            colourBackground: true,
            
            hasSeeds,
            alignmentTarget: hasSeeds ? '_seed' : 'Human',
            
            isAntibody,
            
            filter: undefined,
            tableFilters: {},
            
            selectedColumns: undefined,

            showExportOptions: false,
            showDataExportOptions: false,

            isSequenceLogoVisible: false,
            isHeatmapVisible: false, //TODO: likely redundant with heatmapSelectedColumn
            heatmapSelectedColumn: null,
            heatmapDataScale: 'linear',
            heatmapRelativeToWT: false,
            heatmapColorPalette: 'viridis',
            heatmapDataObject: heatmapDataObject,
            matrixDataObject: {}, // TODO: consider moving heatmap data over to matrix data

            structureKeys: [...STRUCTURE_KEYS],
            visibleStructures: ['structure_url'],
            structureColorScheme: props.isAntibody ? 'CDRs' : 'Diffs to reference',
            structureColoringMetric: null,

            isVariantSelectionActive: false,
            stagedMutations: [],
            acceptedVariants: [],

            analysisImageFields: ['pae_url', 'lddt_url', 'Sensorgram'],
            analysisImageNames: ['Predicted Aligned Error', undefined, 'SPR Sensorgram'],

            leftDataColumns: ['Names', 'seqid', 'seed', 'lineage_light', 'lineage_heavy'],

            nameColumn: 'concept_name',
            refNameColumn,

            ...props,

            columnarData,
            dataColumns: columns,
            hideColumns,

            seqColumns,
            dataRowCount,
            rowIDSeed,

            showSetupMerge: false,
            showSelectByIndex: false,
            showAddColumn: false,
            showingMPNN: false,
            showingLigandMPNN: false,
            showSelectByIndex: false,
            viewingJob: undefined,

            id: id,
            closeTab: this.closeTab.bind(this, id),
            updateTabProps: this.updateTabProps.bind(this, id),
        }

        if (!state.msaTableColumns) {
            state.msaTableColumns = [
                ...((state.msaDataFields || []).filter((c) => state.leftDataColumns.indexOf(c) >= 0)),
                ...(state.selectedSeqColumns || state.seqColumns?.map(({column}) => column) || []),
                ...((state.msaDataFields || []).filter((c) => state.leftDataColumns.indexOf(c) < 0))
            ];
        }

        // Always union-promote columns whose names end in `structure_url` into structureKeys.
        // send-to-gyde loads via session restore (often with a default/partial structureKeys
        // list), so skipping when props.structureKeys is set would miss columns like
        // refolding_structure_url. Extra curated keys are preserved; matching is
        // case-insensitive to match Upload.js nameToDefaultType.
        const autoStructureKeys = [...(state.structureKeys || [])];
        const candidateColumns = new Set([
            ...(state.dataColumns || []),
            ...Object.keys(state.columnarData || {}),
        ]);
        for (const c of candidateColumns) {
            if (typeof c === 'string' && c.toLowerCase().endsWith('structure_url')
                    && autoStructureKeys.indexOf(c) < 0) {
                autoStructureKeys.push(c);
            }
        }
        state.structureKeys = autoStructureKeys;

        return state;

    }

    closeTab(id, ev) {
        if (ev) {ev.preventDefault(); ev.stopPropagation()}

        setTimeout(() => {
            this.setState((state) => {
                const newTabs = state.tabs.filter((t) => t.id !== id)
                return { tabs: newTabs };
            });
        }, 200);

        const newTabs = this.state.tabs.filter((t) => t.id !== id);
        if (newTabs.length && newTabs[newTabs.length -1]._external_id) {
            return `/dataset/${newTabs[newTabs.length - 1]._external_id}`;
        } else {
            return '/';
        }
    }

    updateTabProps(id, transition) {
        this.setState((oldState) => {
            const tix = oldState.tabs.findIndex((t) => t.id === id);
            if (tix < 0) return null;

            const t = oldState.tabs[tix];
            const newTabState = (transition instanceof Function) ? {...t, ...transition(t)} : {...t, ...transition};
            const dataDirty = newTabState.columnarData !== t.columnarData || newTabState.alignedHeavy !== t.alignedHeavy || newTabState.alignedLight !== t.alignedLight ||
                newTabState.anarciHeavy !== t.anarciHeavy || newTabState.anarciLight !== t.anarciLight;
            const newTransitionID = oldState.transitionID + 1;

            const tabKeys = new Set([...Object.keys(t), ...Object.keys(newTabState)])
            tabKeys.delete('selection');
            tabKeys.delete('lastSelectedRow');
            tabKeys.delete('selectedColumns');
            tabKeys.delete('lastSelectedColumn');
            tabKeys.delete('_external_id');
            tabKeys.delete('_old_external_id');
            let configDirty = false;
            for (const k of tabKeys) {
                if (newTabState[k] !== t[k]) {
                    configDirty = true;
                    break;
                }
            }

            const newTabs = [...oldState.tabs];
            newTabs[tix] = newTabState;

            const update = {
                tabs: newTabs,
                transitionID: newTransitionID
            }


            if (dataDirty) {
                const dirtyDataKeys = {...oldState.tabDirtyDataKeys[id]};
                {
                    const dataKeys = new Set([...Object.keys(t.columnarData), ...Object.keys(newTabState.columnarData)]);
                    for (const dk of dataKeys) {
                        if (t.columnarData[dk] !== newTabState.columnarData[dk]) {
                            dirtyDataKeys[dk] = newTransitionID;
                        }
                    }
                }
                update['tabDirtyDataKeys'] = {...oldState.tabDirtyDataKeys, [id]: dirtyDataKeys};
            }

            if (configDirty) {
                update['tabLastTransition'] = {...oldState.tabLastTransition, [id]: newTransitionID}
            }
            if (dataDirty) {
                update['tabLastDataTransition'] = {...oldState.tabLastDataTransition, [id]: newTransitionID};
            }

            return update;
        });
    }

    componentDidMount() {
        this.loadColumnDefs(this.props.columnDefsURL);
        this.loadHistory();

        this.saveIntervalHandle = setInterval(() => {
            if (this.saving) {
                return;
            }

            for (const tab of this.state.tabs) {
                if ((this.state.tabLastTransition[tab.id] || 0) > (this.state.tabLastSave[tab.id] || 0) 
                    && (this.state.savingErrors[tab.id]?.count || 0) <= 2
                    && (!tab._gyde_readonly)) 
                {
                    let saveData = (this.state.tabLastDataTransition[tab.id] || 0) > (this.state.tabLastDataSave[tab.id] || 0);
                    if (saveData && this.state.tabLastDataSave[tab.id]) {
                        saveData = [];
                        for (const [k, lastTrans] of Object.entries(this.state.tabDirtyDataKeys[tab.id] || {})) {
                            if (lastTrans > this.state.tabLastDataSave[tab.id]) {
                                saveData.push(k);
                            }
                        }
                    }
                    const saveTransition = this.state.tabLastTransition[tab.id];
                    const firstSave = !tab._external_id || tab._external_id.startsWith('__new__');
                    
                    (async () => {
                        let success = false;
                        this.saving = true;
                        this.setState((oldState) => ({
                            savingTab: {...oldState.savingTab, [tab.id]: true}
                        }));
                        try {
                            const saveBody = await makeSaveableTabState(tab, saveData);
                            const saveURL = firstSave ? '/store' : `/store/${tab._external_id}`;
                            const resp = await fetch(
                                saveURL,
                                {
                                    method: 'POST',
                                    headers: {
                                        'Content-type': 'application/json',
                                        'Content-Encoding': 'gzip'
                                    },
                                    body: saveBody
                                });
                            if (!resp.ok) {
                                console.log(resp.statusText);
                                throw Error(resp.statusText);
                            }
                            const result = await resp.json();

                            if (firstSave) {
                                const currentTab = this.state.tabs.find((t) => t.id === tab.id);
                                if (currentTab) {
                                    currentTab._old_external_id = currentTab._external_id;
                                    currentTab._external_id = result.id;
                                }
                            }

                            this.setState((oldState) => {
                                if ((oldState.tabLastSave[tab.id] || 0) < saveTransition) {
                                    const update = {
                                        tabLastSave: {...oldState.tabLastSave, [tab.id]: saveTransition},
                                    };

                                    if (firstSave) {
                                        update.sessionHistory = [...(oldState.sessionHistory || []), {id: result.id, name: tab.name, lastModified: (new Date()).toISOString()}]
                                    } else {
                                        update.sessionHistory = oldState.sessionHistory.map((s) => {
                                            if (s.id === tab._external_id) {
                                                return {
                                                    ...s,
                                                    name: tab.name,
                                                    lastModified: new Date().toISOString()
                                                }
                                            } else {
                                                return s;
                                            }
                                        });
                                    }

                                    if (saveData && (oldState.tabLastDataSave[tab.id] || 0) < saveTransition) {
                                        update['tabLastDataSave'] = {...oldState.tabLastDataSave, [tab.id]: saveTransition};
                                    }
                                    
                                    return update;
                                }
                                return null;
                            });
                            success = true;
                        } catch (err) {
                            console.log(err);
                            this.setState((oldState) => ({
                                savingErrors: {
                                    ...oldState.savingErrors,
                                    [tab.id]: {
                                        err: err.message || err,
                                        count: (oldState.savingErrors[tab.id]?.count || 0) + 1
                                    }
                                }
                            }));
                        } finally {
                            this.saving = false;
                            this.setState((oldState) => {
                                const update = {
                                    savingTab: {...oldState.savingTab, [tab.id]: false}
                                };
                                if (success) {
                                    update.savingErrors = {...update.savingErrors, [tab.id]: undefined};
                                }
                                return update;
                            });
                        }

                    })();
                    return;
                }
            }
        }, 5000);

        window.addEventListener('beforeunload', (ev) => {
            let dirtyTabs = 0;
            for (const tab of this.state.tabs) {
                if ((this.state.tabLastTransition[tab.id] ||0) > (this.state.tabLastSave[tab.id] || 0)) ++dirtyTabs;
            }
            if (dirtyTabs) {
                ev.preventDefault();
                return ev.returnValue = `Are you sure you want to leave GYDE?  Results from ${dirtyTabs} tabs not yet saved`;
            }
        }, true);
    }

    componentWillUnmount() {
        clearInterval(this.saveIntervalHandle);
        this.saveIntervalHandle = undefined;
    }
 
    async loadHistory() {
        try {
            const resp = await fetch('/store');
            if (!resp.ok) throw Error(resp.statusText);
            const data = await resp.json();
            this.setState({sessionHistory: data.filter(s => !this.deletedWorkspaces.has(s.id)), sessionHistoryErr: null});
        } catch (err) {
            console.log(err);
            this.setState({sessionHistoryErr: err});
        }
    }

    async loadColumnDefs(url) {
      this.setState({
        columnDefs: null
      })

      const resp = await fetch(url);
      if (!resp.ok) throw Error(resp.statusText);
      const data = await resp.text();
      const columns = csvParse(data)
        .map((col) => ({
          descriptor: col['Descriptor'],
          definition: (col['Definition'] && col['Definition'].length > 0) ? col['Definition'] : undefined,
          showByDefault: col['Default column'] === 'yes'
        }));

      this.setState({
        columnDefs: columns
      });
    }

    render() {
        const {tabs, selectedTab, selectedOption} = this.state;
        const selectedTabState = (selectedTab && tabs.filter((t) => t.id === selectedTab)[0]);

        const home = (
            <Homepage
                selectedOption={selectedOption}
                setSelectedOption={(val) => this.setState({selectedOption: val})}
                onDataLoad={this.onDataLoad}
                sessionHistory={this.state.sessionHistory}
                sessionHistoryErr={this.state.sessionHistoryErr}
                sessionActionErrors={this.state.sessionActionErrors}
                deletingSessions={this.state.deletingSessions}
                refreshHistory={this.loadHistory}
                tabs={this.state.tabs}
                loadHistoricalSession={this.loadHistoricalSession}
                switchToHistoricalSession={this.switchToHistoricalSession}
                deleteHistoricalSession={this.deleteHistoricalSession} 
                updateShareFlag={this.updateShareFlag} 
                updateDescription={this.updateDescription}
                updateName={this.updateName}
                extraDatasetComponents={this.props.extraDatasetComponents}
                idLookups={this.props.idLookups}
                landingPageAddendum={this.props.landingPageAddendum}
            />
        );

        return (
          <ThemeProvider theme={gtheme}>
            <div className="App">
                <BrowserRouter>
                    <Routes>
                        <Route index element={home} />
                        <Route path="/dataset/:dsid"
                               element={
                                   <TabViewWrapper
                                        tabs={tabs}
                                        loadFailures={this.state.loadFailures}
                                        selectedTabState={selectedTabState}
                                        savingErrors={this.state.savingErrors}
                                        savingTab={this.state.savingTab}
                                        tabLastTransition={this.state.tabLastTransition}
                                        tabLastSave={this.state.tabLastSave}
                                        columnDefs={this.state.columnDefs}
                                        cdrPos={this.props.cdrPos}
                                        vernierPos={this.props.vernierPos}
                                        alignmentTargets={this.getAlignmentTargets()}
                                        makeCopy={this.makeCopy}
                                        onDataLoad={this.onDataLoad}
                                        loadHistoricalSession={this.loadHistoricalSession}
                                    />
                                } />
                        <Route path="/new" element={home} />
                        <Route path="/new/:ccc" element={home} />
                        <Route path="/datasets" element={home} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                        

                    </Routes>
                </BrowserRouter>
            </div>
          </ThemeProvider>
        );
    }

    onDataLoad(data, opts='New dataset') {
        if (typeof(opts) === 'string') {
            opts = {
                name: opts
            };
        }

        function cleanNaN(x) {
            if (typeof(x) !== 'number' || x !== x) return undefined;
            return x;
        }

        let columnarData, indexedData, dataRowCount;
        let seeds = {};

        if (data) {
            indexedData = data.map((d, i) => ({
                ...d,
                id: i, 
                seqid: d['ABP ID'] || d.seqid || d.merge_seqid || `_seq${i}`
            })).map((d, idx) => {
                const {seqid, seed_seqid} = d;
                // We originally only "trusted" seqid if it looked like an ABP ID.  In practice,
                // we want to be much more general than this (to handle PDB etc.).  However, still
                // exclude seqids that are >=32 characters long, because they are probably md5s of
                // Prescient sequences.
                const name = ((seqid && (seqid.startsWith('ABP') || seqid.length < 32)) ? seqid :
                              ((seqid === seed_seqid ? 'seed' : `seq${idx}`)));
                return {
                    ...d,
                    name
                }
            });

            indexedData.columns = [...data.columns];
            if (indexedData.columns.indexOf('seed_HC_alignment') >= 0) {
                // We currently re-use the "germline" data model here to facilitate code reuse in "Study".  This should
                // probably become less germine-specific in future.
                seeds.seedHeavy = prepareSequences(indexedData, 'seed_HC_alignment').map((n) => ({germLineSeq: n.seq, seqName: n.name}));
                seeds.seedLight = prepareSequences(indexedData, 'seed_LC_alignment').map((n) => ({germLineSeq: n.seq, seqName: n.name}));
            }

            if (!opts.seqColumns) {
                opts.seqColumns = [];
                if (indexedData.columns.indexOf('HC_sequence') >= 0) opts.seqColumns.push({column: 'HC_sequence'});
                if (indexedData.columns.indexOf('LC_sequence') >= 0) opts.seqColumns.push({column: 'LC_sequence'});
            }

            const allKeys = new Set();
            for (const d of indexedData) {
                for (const k of Object.keys(d)) {
                    allKeys.add(k);
                }
            }

            columnarData = {};
            for (const k of allKeys) {
                columnarData[k] = indexedData.map((d) => d[k]);
            }

            dataRowCount = indexedData.length;
        } else {
            columnarData = opts.columnarData;
            if (!columnarData) {
                throw Error('must specify either "data" or "columnarData"')
            }

            dataRowCount = Math.max((columnarData.seqid || []).length, (columnarData.name || []).length, (columnarData.HC_sequence || []).length);
        }

        const dataColumns = opts.dataColumns || indexedData?.columns || Object.keys(columnarData);

        const tabData = this.newTabState({
            ...opts,
            columnarData,
            dataColumns,
            ...seeds
        });

        if (tabData.dataRowCount === undefined) {
            tabData.dataRowCount = dataRowCount;
        }

        if (tabData.isAntibody && !tabData.hcColumn) {
            tabData.hcColumn = tabData.seqColumns.findIndex(({column}) => column === 'HC_sequence') >= 0 ? 'HC_sequence' : null;
        }
        if (tabData.isAntibody && !tabData.lcColumn) {
            tabData.lcColumn = tabData.seqColumns.findIndex(({column}) => column === 'HC_sequence') >= 0 ? 'LC_sequence' : null;
        }

        if (tabData.isAntibody && !tabData.seqColumnNames) {
           tabData.seqColumnNames = tabData.seqColumns.map(({column: col}) => {
                if (col === tabData.hcColumn) return 'Heavy chains';
                if (col === tabData.lcColumn) return 'Light chains';
                return null;
            });
        }

        if (tabData.isAntibody && !tabData.lcColumn && !tabData.hcColumn) {
            throw new Error('antibody datasets should have at least one of HC or LC');
        }

        if (!tabData._external_id) {
            tabData._external_id = `__new__${Date.now()}`;
        }

        this.setState((oldState) => {
            const transitionID = oldState.transitionID + 1;

            return {
                transitionID,
                tabs: [...oldState.tabs, tabData],
                tabLastTransition: {
                    ...oldState.tabLastTransition,
                    [tabData.id]: transitionID
                },
                tabLastDataTransition: {
                    ...oldState.tabLastDataTransition,
                    [tabData.id]: transitionID
                }
            }
        });

        return `/dataset/${tabData._external_id}`;
    }

    async loadHistoricalSession(sid) {
        if (this.deletedWorkspaces.has(sid) || this.deletingWorkspaces.has(sid) || this.loadingWorkspaces.has(sid) || this.state.tabs.some((t) => t._external_id === sid)) return;
        this.loadingWorkspaces.add(sid);
        this.setState((state) => ({
            loadingSession: true,
            loadFailures: {...state.loadFailures, [sid]: undefined}
        }));

        try {
            const resp = await fetch(`/store/${sid}`);

            if (!resp.ok) throw Error(resp.statusText || (resp.status === 404 ? 'Not found' : `status=${resp.status}`));
            const savedTabState = await resp.json();
            const tabState = hydrateTabState(savedTabState);

            if (tabState.dataColumns.indexOf('user_notes') < 0) tabState.dataColumns.push('user_notes');

            const tabData = this.newTabState({
                ...tabState,
                _external_id: sid
            });

            const tabLayout = [...(tabData.layout || [])];
            for (const l of LAYOUT) {
                if (tabLayout.findIndex((tl) => tl.name === l.name) < 0) {
                    tabLayout.push(l);
                }
            }
            tabLayout.forEach((item, index) => item.index = index);
            tabData.layout = tabLayout;

            this.setState((oldState) => {
                if (this.deletedWorkspaces.has(sid)) return null;
                const transitionID = oldState.transitionID + 1;
                const transition = {
                    transitionID,
                    tabs: [...oldState.tabs, tabData],
                    home: false,
                };

                if (savedTabState.columnarData) {
                    transition.tabLastDataSave = {
                        ...oldState.tabLastDataSave,
                        [tabData.id]: transitionID
                    }
                }

                return transition;
            }, () => this.loadingWorkspaces.delete(sid));
        } catch (err) {
            this.loadingWorkspaces.delete(sid);
            console.log(err);
            this.setState((oldState) => ({
                loadFailures: {
                    ...(oldState.loadFailures || {}),
                    [sid]: (err?.message ?? err) || 'failed'
                }
            }));
        } finally {
            this.setState({
                loadingSession: false
            });
        }
    }

    switchToHistoricalSession(sid) {
        this.setState((oldState) => {
            const targetTab = oldState.tabs.find((t) => t._external_id === sid);
            if (targetTab) {
                return {
                    selectedTab: targetTab.id,
                    home: false
                };
            } else {
                return null;
            }
        });
    }

    async deleteHistoricalSession(sid) {
        if (!sid || this.deletingWorkspaces.has(sid) || this.deletedWorkspaces.has(sid)) return;
        this.deletingWorkspaces.add(sid);
        this.setState(oldState => ({deletingSessions: [...this.deletingWorkspaces],
            sessionActionErrors: {...oldState.sessionActionErrors, [sid]: undefined}}));
        const removeFromView = () => {
            this.deletedWorkspaces.add(sid);

            this.setState((oldState) => ({
                sessionHistory: (oldState.sessionHistory || []).filter((s) => s.id !== sid),
                tabs: oldState.tabs.filter((t) => t._external_id !== sid),
                sessionActionErrors: {...oldState.sessionActionErrors, [sid]: undefined},
            }));
        };
        try {
            const resp = await fetch(`/store/${sid}`, {method: 'DELETE'});
            if (!resp.ok) throw Error(await requestError(resp, 'Could not delete dataset'));
            removeFromView();
        } catch (err) {
            // A connection can fail after the server commits the delete. Reconcile
            // against the authorized list; never repeat a destructive request.
            let absent = false;
            try {
                const resp = await fetch('/store');
                if (resp.ok) {
                    const rows = await resp.json();
                    absent = Array.isArray(rows) && !rows.some(row => row.id === sid);
                }
            } catch {}
            if (absent) removeFromView();
            else this.setState(oldState => ({sessionActionErrors: {...oldState.sessionActionErrors,
                [sid]: err?.message || 'Could not confirm deletion. Refresh the dataset list and try again.'}}));
        } finally {
            this.deletingWorkspaces.delete(sid);
            this.setState({deletingSessions: [...this.deletingWorkspaces]});
        }
    }

    async updateShareFlag(sid, shared, isPublic) {
        try {
            const saveURL = `/store/${sid}`;
            const resp = await fetch(
                saveURL,
                {
                    method: 'POST',
                    headers: {
                        'Content-type': 'application/json'
                    },
                    body: JSON.stringify({shared, public: shared && isPublic})
                });
            if (!resp.ok) {
                console.log(resp.statusText);
                throw Error(resp.statusText);
            }

            this.setState((oldState) => ({
                sessionHistory: oldState.sessionHistory.map((s) => s.id === sid ? {...s, shared, public: shared && isPublic} : s)
            }));
        } catch (err) {
            alert(err.message || err);
        }
    }

    async updateDescription(sid, description) {
        try {
            const saveURL = `/store/${sid}`;
            const resp = await fetch(
                saveURL,
                {
                    method: 'POST',
                    headers: {
                        'Content-type': 'application/json'
                    },
                    body: JSON.stringify({description})
                });
            if (!resp.ok) {
                console.log(resp.statusText);
                throw Error(resp.statusText);
            }

            this.setState((oldState) => ({
                sessionHistory: oldState.sessionHistory.map((s) => s.id === sid ? {...s, description} : s)
            }));
        } catch (err) {
            alert(err.message || err);
        }
    }

    async updateName(sid, name) {
        try {
            const saveURL = `/store/${sid}`;
            const resp = await fetch(
                saveURL,
                {
                    method: 'POST',
                    headers: {
                        'Content-type': 'application/json'
                    },
                    body: JSON.stringify({name})
                });
            if (!resp.ok) {
                console.log(resp.statusText);
                throw Error(resp.statusText);
            }

            this.setState((oldState) => ({
                tabs: oldState.tabs.map((t) => t._external_id === sid ? {...t, name} : t),
                sessionHistory: oldState.sessionHistory.map((s) => s.id === sid ? {...s, name} : s)
            }));
        } catch (err) {
            alert(err.message || err);
        }
    }

    makeCopy(id) {
        const nid = `__new__copy__${Date.now()}`;

        this.setState((oldState) => {
            const newTransitionID = oldState.transitionID + 1;
            return {
                tabs: oldState.tabs.map((t) => {
                    if (t.id === id) {
                        return {...t, _gyde_readonly: undefined, _external_id: nid}
                    } else {
                        return t;
                    }
                }),
                transitionID: newTransitionID,
                // Need these to ensure that the next save is a "full" save.
                tabLastSave:  {...oldState.tabLastSave, [id]: undefined},
                tabLastDataSave:  {...oldState.tabLastDataSave, [id]: undefined},
                tabLastTransition: {...oldState.tabLastTransition, [id]: newTransitionID},
                tabLastDataTransition: {...oldState.tabLastDataTransition, [id]: newTransitionID},
            }
        });

        return `/dataset/${nid}`;
    }

    getAlignmentTargets() {
        return this._getAlignmentTargets(this.props.alignmentTargets, this.props.slivkaService?.services);
    }

    _getAlignmentTargets = memoize((alignmentTargets, services) => {
        const availableServices = new Set((services || []).map((s) => s.id));

        return (alignmentTargets || []).filter(({gateOnService: gos}) => !gos || availableServices.has(gos));
    });
}

export default function App(props) {
    return (
        <SlivkaServiceContext.Consumer>
            { (slivkaService) => (
                <_App {...props} 
                      slivkaService={slivkaService} />) }
        </SlivkaServiceContext.Consumer>
    );
}

export function prepareSequences(data, key, suffix='') {
    return data.map(({name, ...rest}, idx) => {
        const sname = name + suffix;

        return {
            // Matching the properties made by msa.io.fasta.  Not totally
            // sure that all of these are actually needed...
            name: sname,
            id: idx,
            ids: {},
            details: {'en': sname},
            seq: rest[key]
        }
    }).filter((s) => s.seq);
}


function TabViewWrapper(props) {
    const {tabs, loadFailures={}, loadHistoricalSession, onDataLoad: onDataLoadInternal} = props;
    const params = useParams();
    const sid = params.dsid,
                failed = loadFailures[sid]

    const navigate = useNavigate();

    const selectedTabState = tabs.find((t) => t._external_id === sid || t._old_external_id === sid);

    useEffect(() => {
        if (selectedTabState && selectedTabState._old_external_id === sid && selectedTabState._external_id !== selectedTabState._old_external_id) {
            navigate(`/dataset/${selectedTabState._external_id}`);
        }
    });

    useEffect(() => {
        if (!selectedTabState) {
            const t = setTimeout(() => {
                loadHistoricalSession(sid);
            }, 500);
            return () => {clearTimeout(t)}

        }
    }, [selectedTabState, sid]);

    useEffect(() => {
        if (failed) {
            const t = setTimeout(
                () => {navigate('/')},
                5000
            );
            return () => {clearTimeout(t)};
        }
    }, [failed]);

    const onDataLoad = useCallback((data, opts) => {
        const url = onDataLoadInternal(data, opts);
        navigate(url);
    }, [onDataLoadInternal, navigate]);

    if (selectedTabState) {
        return (
            <TabView key={selectedTabState.id /* Important to create a new Study on tab-switch */}
                     {...props}
                     onDataLoad={onDataLoad}
                     selectedTabState={selectedTabState} />
        )
    } else {
        return (
            <div style={{display: 'flex', flexDirection: 'column', height: '100vh'}}>
                <LogoPage>
                    <div style={{display: 'flex', flex: '1 1 100px', alignItems: 'center'}}>
                        <div>{failed ? failed.toString() : "Loading"}</div>
                    </div>
                </LogoPage>
            </div>
        )
    }
}
