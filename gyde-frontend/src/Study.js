import RenameColumn from './RenameColumn';
import {isTamarindCompute} from './compute';
import React, {useState, useCallback, useRef, useEffect} from 'react';
import {canStartAutomaticAlignment} from './workspacePersistence';
import {
    Grid, LinearProgress, CircularProgress, Button, ButtonGroup, Tooltip, Menu, MenuItem, Paper,
    Dialog, DialogTitle, DialogContent, TextField, DialogActions, FormControl, InputLabel, Select,
    DialogContentText, IconButton
} from '@mui/material';
import {Gesture as LassoIcon, SelectAll as SelectIcon, ZoomIn as ZoomIcon,
        ContentPasteGo as Paste, Upload, Close} from '@mui/icons-material';

import memoize from 'memoize-one';

import SequenceTable, {orderBySeedsColumnar, applyTableFilters, makeSortedTableSwizzlePrioritizingSeeds} from './SequenceTable.js';
import TAPPlot from './plotting/TAPPlot.js';
import {PlotCombo} from './plotting/PlotHolder.js';
import StructureHolder from './structureView/StructureHolder.js';
import {MPNNControls} from './analysis/RunMPNN.js';
import LigandMPNN from './analysis/LigandMPNN.js';

import {predictedStructureABB, molDesk, therapeuticAntibodyProfiler} from './analysis/analysis.js';
import {matchAlign, anarciMakeAlign, mafftAlign} from './analysis/alignment.js';
import {humanize} from './analysis/humanize.js';
import MSA_COLORS from './gmsa/colorschemes';
import {translateDNA} from './utils/sequence';
import {arrayCmp} from './utils/utils';

import {exportSequenceTable, exportSequenceTableCSV, SequenceTableExportControls} from './SequenceTableExport';
import {saveAs} from 'file-saver';
import { NavBar } from './NavBar.js';
import HeatmapNavBar from './HeatmapNavBar.js';
import { HeatmapData } from './gmsa/HeatmapUtils.js';
import FrequencyAnalysis from './frequencyAnalysis/FrequencyAnalysis.js';
import Sidebar from './Sidebar';
import { PingerContext } from './Pinger';
import VariantSelection, {ShoppingCart} from './VariantSelection.js';
import BindConfig from './BindConfig.js';
import Restraints from './Restraints.js';
import SelectByIndex from './SelectByIndex';
import {tableFromClipboard, DataTableConfigurator} from './Upload.js'
import {loadSpreadsheet, readAsArrayBuffer} from './utils/loaders';

import {SlivkaServiceContext, JobView} from './czekolada/lib';

const MSA_TYPEFACES = [
    {
        name: 'Inconsolata',
        systemFont: 'Inconsolata',
        systemFontScale: 0.9
    },
    {
        name: 'Courier',
        systemFont: 'Courier',
        systemFontScale: 0.83
    },
    {
        name: 'Arial',
        systemFont: 'Arial, Helvetica',
        systemFontScale: 0.50
    }
]

const CONSTANT_EMPTY = [];
const CONSTANT_NUMBERED_EMPTY = [];
CONSTANT_NUMBERED_EMPTY.residueNumbers = CONSTANT_EMPTY;

function PlotControlMenu({plotCols, plotRows, setState}) {
    const anchorRef = useRef();
    const [menuOpen, setMenuOpen] = useState(false);
    const openMenu = useCallback((ev) => {
        ev.preventDefault(); ev.stopPropagation();
        setMenuOpen(true)
    }, [setMenuOpen]);
    const closeMenu = useCallback(() => {
        setMenuOpen(false);
    }, [setMenuOpen]);

    const updatePlots = (dCols, dRows) => {
        setMenuOpen(false);

        setState((oldState) => {
            let newCols = oldState.plotCols + dCols,
                newRows = oldState.plotRows + dRows,
                newPlots = [...oldState.plots];

            let target = newCols * newRows;
            if (!target) {
                window.alert('Cannot remove all plots');
                return;
            }
            if (target < newPlots.length) {
                newPlots = newPlots.filter((plot) => plot.axis1 !== undefined || plot.axis2 !== undefined);
                if (target < newPlots.length) {
                    if (!window.confirm('Your plots will not fit the new layout, really remove cells?')) return;
                    newPlots.splice(target, newPlots.length - target);
                }
            }
            if (target > newPlots.length) {
                for (let i = newPlots.length; i < target; ++i) {
                    newPlots.push({
                    })
                }
            }            

            return {
                plotRows: newRows, plotCols: newCols, plots: newPlots
            };
        });
    }

    return (
        <React.Fragment>
            <Button aria-controls="plot-control-menu" 
                    aria-haspopup="true"
                    onClick={openMenu}
                    ref={anchorRef}
                    variant="contained" >
                [Add/remove plots]
            </Button>
            <Menu id="plot-control-menu"
                  anchorEl={anchorRef.current}
                  keepMounted
                  open={menuOpen}
                  onClose={closeMenu}>
                <MenuItem onClick={ (ev) => { ev.preventDefault(); ev.stopPropagation(); updatePlots(1, 0) } }>
                    Add column
                </MenuItem>
                <MenuItem onClick={ (ev) => { ev.preventDefault(); ev.stopPropagation(); updatePlots(-1, 0) } }>
                    Remove column
                </MenuItem>
                <MenuItem onClick={ (ev) => { ev.preventDefault(); ev.stopPropagation(); updatePlots(0, 1) } }>
                    Add row
                </MenuItem>
                <MenuItem onClick={ (ev) => { ev.preventDefault(); ev.stopPropagation(); updatePlots(0, -1) } }>
                    Remove row
                </MenuItem>
            </Menu>
        </React.Fragment>

    )
}

class WidgetBoundaryWrapper extends React.Component {
    constructor(props) {
        super(props);

        this.state = {error: undefined};

        this.resetButton = this.resetButton.bind(this);
    }

    resetButton() {
        this.setState({error: undefined});
    }

    static getDerivedStateFromError(err) {
        return {error: err};
    }

    componentDidCatch(err, info) {
        console.log('error caught', err, info);
    }

    render() {
        const {children} = this.props;
        const {error} = this.state;

        if (error) {
            return (
                <div>
                    Sorry, rendering of this widget has failed.  

                    <pre>
                        { error.message || error.toString() }
                    </pre>

                    <Button onClick={this.resetButton}>
                        Try again.
                    </Button>
                </div>
            )
        } else {
            return (
                <React.Fragment>
                    { children }
                </React.Fragment>
            )
        }
    }
}

class _Study extends React.Component {
    constructor(props) {
        super(props);

        this.runMolDesk = this.runMolDesk.bind(this);
        this.runTAP = this.runTAP.bind(this);
        this.updateSelectionFromMSA = this.updateSelectionFromMSA.bind(this);
        this.updateSelectedColumns = this.updateSelectedColumns.bind(this);
        this.doInvertSelectedColumns = this.doInvertSelectedColumns.bind(this);
        this.updateSelectedOtherColumns = this.updateSelectedOtherColumns.bind(this);
        this.toggleMSADataField = this.toggleMSADataField.bind(this);
        this.reorderMSADataFields = this.reorderMSADataFields.bind(this);
        this.toggleDataField = this.toggleDataField.bind(this);
        this.reorderDataFields = this.reorderDataFields.bind(this);
        this.updateSortField = this.updateSortField.bind(this);
        this.humanizeAction = this.humanizeAction.bind(this);
        this.toggleAlternateAction = this.toggleAlternateAction.bind(this);
        this.updateDatum = this.updateDatum.bind(this);
        this.addValueToNewStructureColumn = this.addValueToNewStructureColumn.bind(this);
        this.doFilter = this.doFilter.bind(this);
        this.doUnfilter = this.doUnfilter.bind(this);
        this.doColumnFilter = this.doColumnFilter.bind(this);
        this.doColumnUnfilter = this.doColumnUnfilter.bind(this);
        this.doColumnUnfilterRange = this.doColumnUnfilterRange.bind(this);
        this.doColumnFilterByHeatmap = this.doColumnFilterByHeatmap.bind(this);
        this.doColumnFilterByNonGap = this.doColumnFilterByNonGap.bind(this);
        this.doExport = this.doExport.bind(this);
        this.doDataExport = this.doDataExport.bind(this);
        this.doSelectAll = this.doSelectAll.bind(this);
        this.doSelectNone = this.doSelectNone.bind(this);
        this.doInvertSelection = this.doInvertSelection.bind(this);
        this.updateLayout = this.updateLayout.bind(this);
        this.checkUpdateLayout = this.checkUpdateLayout.bind(this);

        this.setState = this.setState.bind(this);
        this.updateTableFilters = this.updateTableFilters.bind(this);
        this.updateTableFormats = this.updateTableFormats.bind(this);

        this.showExportOptions = this.showExportOptions.bind(this);
        this.hideExportOptions = this.hideExportOptions.bind(this);
        this.showDataExportOptions = this.showDataExportOptions.bind(this);
        this.hideDataExportOptions = this.hideDataExportOptions.bind(this);

        this.showMerge = this.showMerge.bind(this);
        this.hideMerge = this.hideMerge.bind(this);
        this.setViewingJob = this.setViewingJob.bind(this);
        this.showSelectByIndex = this.showSelectByIndex.bind(this);
        this.hideSelectByIndex = this.hideSelectByIndex.bind(this);

        this.setAutoSuperpose = this.setAutoSuperpose.bind(this);
        this.setExplicitReference = this.setExplicitReference.bind(this);
        this.setSuppressDatasetReference = this.setSuppressDatasetReference.bind(this);

        this.doAddColumn = this.doAddColumn.bind(this);

        this.createRestraintFromSelection = this.createRestraintFromSelection.bind(this);
        this.updateRestraint = this.updateRestraint.bind(this);
        this.deleteRestraint = this.deleteRestraint.bind(this);

        this._plotSetters = [];

        this.sequenceTableRef = React.createRef();
        this.structureRef = React.createRef();
        this.structAnalysisRef = React.createRef();
        this.plotRef = React.createRef();
        this.TAPRef = React.createRef();
        this.dataRef = React.createRef();
        this.frequencyAnalysisRef = React.createRef();
        this.shoppingCartRef = React.createRef();
        this.restraintRef = React.createRef();

        this.primaryNavBarExtrasRef = React.createRef();
    }

    setViewingJob(jobId, explicitURL) {
        const resultUrl = this.props.slivkaService?.getJobStatus(jobId)?.resultUrl;
        if (resultUrl && isTamarindCompute()) {
            window.open(resultUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        this.setState({viewingJob: {jobId, explicitURL}});
    }

    cancelSlivkaJob = async (jobId) => {
        try {
            await this.props.slivkaService.cancel(jobId);
        } catch (err) {
            console.warn('Cancel request failed:', err);
        }
    }

    showMerge() {
        this.setState({showSetupMerge: true});
    }

    hideMerge() {
        this.setState({showSetupMerge: false});
    }

    showSelectByIndex() {
        this.setState({showSelectByIndex: true});
    }

    hideSelectByIndex() {
        this.setState({showSelectByIndex: false});
    }

    showExportOptions() {
        this.setState({showExportOptions: true});
    }

    hideExportOptions() {
        this.setState({showExportOptions: false});
    }

    showDataExportOptions() {
        this.setState({showDataExportOptions: true});
    }

    hideDataExportOptions() {
        this.setState({showDataExportOptions: false});
    }

    doExport(opts) {
        this.setState({showExportOptions: false});
        return this.doExportImpl(opts, this.props.msaTableColumns, this.props.columnDisplayNames);
    }

    doDataExport(opts) {
        this.setState({showDataExportOptions: false});
        return this.doExportImpl(opts, this.props.dataFields, this.props.columnDisplayNames);
    }

    async doExportImpl(opts, dataFields, columnDisplayNames={}) {
        try {
            const {format, exportAll, exportAllColumns, includeSelectedSeqColumns, includeMSA, includeMSAGermlineDiff} = opts;
            const {tableFilters, columnarData, nameColumn='concept_name', refNameColumn='seed'} = this.props;

            const {dataRows, viewColumnarData} = this.getViewData();

            const filter = applyTableFilters(viewColumnarData, dataRows, tableFilters || {}, this.getFilterIndices(this.props.filter, columnarData._gyde_rowid));
            const alignments = this.getAlignments(),
                  references = this.getReferences();
            //const aligmentFeatures = this.mapFeatureSets(alignmentKey, alignments, this.props.seqColumns, this.props.cdrPos, this.props.vernierPos);
            
            if (exportAllColumns) {
                dataFields = this.getVisibleColumns();
            }

            const columns = [];

            for (const column of dataFields) {
                if (this.props.seqColumns.find(({column: c}) => c === column)) continue;

                if (viewColumnarData[column]) {
                    columns.push({
                        name: columnDisplayNames[column] ?? column,
                        accessor: (index, data) => data[column][index],
                        style: (column === refNameColumn) ?
                            (index, data) => {
                                 if (data[refNameColumn][index] && data[nameColumn][index] && data[nameColumn][index].split('.')[0] === data[refNameColumn][index]) {
                                    return ({'fill': 'ee8888'})
                                 }
                            } : null
                    });
                }
            }

            if (includeSelectedSeqColumns) {
                if (this.props.selectedColumns) {
                    this.props.seqColumns.forEach(({column: seqColumn}, seqColIndex) => {
                        const aliColumns = Array.from(this.props.selectedColumns[seqColIndex] || []);
                        aliColumns.sort((a, b) => a-b);
                        if (aliColumns.length === 0) return;

                        columns.push({
                            name: (this.props.seqColumnNames||[])[seqColIndex] || `Sequence ${seqColIndex+1}`,
                            subcolumns: aliColumns.map((pos) => ({
                                name: '' + alignments[seqColIndex].residueNumbers[pos],
                                accessor: (index, data, alignments, references) => alignments[seqColIndex][index][pos],
                                style: (index, data, alignments, references) => {
                                    if (((references||[])[seqColIndex]|[])[index] && references[seqColIndex][index][pos] !== alignments[seqColIndex][index][pos]) {
                                        return {
                                            fill: '000000',
                                            fontColor: 'ffffff'
                                        }
                                    }                           
                                }
                            }))
                        });
                    })
                }
            }

            if (includeMSA) {
                this.props.seqColumns.forEach(({column: seqCol}, seqColIndex) => {
                    columns.push({
                        name: seqCol+'_alignment',
                        accessor: (index, data, alignments, references) => alignments[seqColIndex][index]
                    });
                });
            }

            if (includeMSAGermlineDiff) {
                this.props.seqColumns.forEach(({column: seqCol}, seqColIndex) => {
                    columns.push({
                        name: seqCol+'_reference_diff',
                        accessor: (index, data, alignments, references) => {
                            let result = '';

                            const align = ((alignments[seqColIndex])||[])[index] || '',
                                  ref = (((references||[])[seqColIndex])||[])[index];

                            const isReference = columnarData[nameColumn] && columnarData[refNameColumn] && columnarData[nameColumn][index] && columnarData[nameColumn][index] === columnarData[refNameColumn][index];

                            for (let i = 0; i < align.length; i++) {
                                if (!ref || isReference) {
                                    result += align[i];
                                } else if (align[i] === '-') {
                                    result += ' '
                                } else if (align[i] === ref[i]) {
                                    result += '-';
                                } else {
                                    result += align[i];
                                }
                            }

                            return result;
                        }
                    });
                });
            };

            let swizzle;
            let key = this.props.sortField, reverse=false;
            if (key && key[0] === '-') {
                key = key.substring(1);
                reverse = true;
            }

            if (refNameColumn && key === refNameColumn) {
                swizzle = orderBySeedsColumnar(columnarData, reverse, filter, nameColumn, refNameColumn);
            } else {
                const sortData = viewColumnarData[key];
                swizzle = makeSortedTableSwizzlePrioritizingSeeds(sortData || dataRows, exportAll ? null : filter, dataRows, reverse, nameColumn, refNameColumn, columnarData);
            }

            const exporter = format === 'csv' ? exportSequenceTableCSV : exportSequenceTable;
            const exportData = await exporter(columns, viewColumnarData, alignments, references, swizzle);
            saveAs(exportData, format === 'csv' ? 'gyde-export.csv' : 'gyde-export.xlsx');
        } catch (err) {
            alert(`Export failed: ${err?.message ?? err.toString()}`);
        }
    }

    setDefaultSelection() {
        if (!this.props.selection || this.props.selection.size === 0) {
            const rowids = this.props.columnarData._gyde_rowid;
            if (this.props.sortField) {
                const filter = this.getFilterIndices(this.props.filter, this.props.columnarData._gyde_rowid)
                const {viewColumnarData, dataRows} = this.getViewData();

                let swizzle;
                let key = this.props.sortField, reverse=false;
                if (key && key[0] === '-') {
                    key = key.substring(1);
                    reverse = true;
                }

                if (key === this.props.refNameColumn) {
                    swizzle = orderBySeedsColumnar(viewColumnarData, reverse, filter, this.props.nameColumn || 'concept_name', this.props.refNameColumn || 'seed');
                } else {
                    const sortData = viewColumnarData[key];
                    swizzle = makeSortedTableSwizzlePrioritizingSeeds(sortData || dataRows, filter, dataRows, reverse, this.props.nameColumn || 'concept_name', this.props.refNameColumn || 'seed', viewColumnarData);
                }

                if (swizzle) {
                    this.setState({selection: new Set([swizzle[0]].map((i) => rowids[i]))});
                    return;
                }
            } 
            this.setState({selection: new Set([0].map((i) => rowids[i]))});
        }
    }

    setExplicitReference(explicitReference) {
        this.setState((oldState) => {
            return {
                explicitReference: oldState.columnarData._gyde_rowid[explicitReference],
                alignmentTarget: undefined,
                suppressDatasetReference: false
            }
        });
    }

    setSuppressDatasetReference() {
        this.setState({
            explicitReference: undefined,
            alignmentTarget: undefined,
            suppressDatasetReference: true
        });
    }

    createRestraintFromSelection() {
        this.setState((oldState) => {
            const {selectedColumns=[], seqColumns=[], selectedOtherColumns={}} = oldState;

            const selSites = [];
            seqColumns.forEach(({column}, i) => {
                const sel = selectedColumns[i] || [];
                for (const pos of sel) {
                    selSites.push({column, pos});
                }
            });


            Object.entries(selectedOtherColumns).forEach(([column, selected]) => {
                if (selected) {
                    selSites.push({column, pos: undefined, ligand: true})
                }
            });


            if (selSites.length !== 2) {
                alert('Currently only support restraints between two residues (or ligands)');
                return null;
            }

            const newRestraint = {
                id: `restraint${Date.now()}`,
                fromSeqCol: selSites[0].column,
                fromSeqPos: selSites[0].pos,
                fromLigand: selSites[0].ligand,
                toSeqCol: selSites[1].column,
                toSeqPos: selSites[1].pos,
                toLigand: selSites[1].ligand,
                name: '',
                minAngstroms: 0.0,
                maxAngstroms: 5.0,
                confidence: 1.0
            };

            return {
                isRestraintUIActive: true,
                restraints: [...(oldState.restraints || []), newRestraint]
            };
        });
    }

    updateRestraint(rid, update) {
        this.setState((oldState) => {
            const newRestraints = [...oldState.restraints || ([])];
            for (let i = 0; i < newRestraints.length; ++i) {
                if (newRestraints[i]?.id === rid) {
                    newRestraints[i] = {...newRestraints[i], ...update};
                };
            }
            return {restraints: newRestraints};
        });
    }

    deleteRestraint(rid) {
        this.setState((oldState) => {
            return {restraints: (oldState.restraints || []).filter((r) => r?.id !== rid)};
        });
    }

    componentDidUpdate(oldProps, oldState) {
        // On first update after alignment data is available, set a selection if none already set.
        if (this.getAlignmentsKey(this.props) && !this.getAlignmentsKey(oldProps)) {
            this.setDefaultSelection();
        }

        if (oldProps.alignmentTarget !== this.props.alignmentTarget && this.props.isAntibody) {
            const {alignmentTarget, alignmentTargets} = this.props;
            const realAlignmentTarget = alignmentTarget?.startsWith('_seed+') ? alignmentTarget.substring(6) : alignmentTarget;
            const target = alignmentTargets?.filter(({name}) => name === realAlignmentTarget)[0] || alignmentTargets?.[0];
            if (target) {
                this.runNumberingAlignment(target.name, target.aligner, alignmentTarget, target.numberingOnly);
            }
        }

        function extraAnalysisColumns(props) {
            const cols = new Set();
            if (props.tapResults && Object.values(props.tapResults).length > 0) {
                for (const c of Object.keys(Object.values(props.tapResults)[0])) cols.add(c);
            }
            if (props.molDeskResults && Object.values(props.molDeskResults).length > 0) {
                for (const c of Object.keys(Object.values(props.molDeskResults)[0])) cols.add(c);
            }
            return cols;
        }
        if (this.props.tapResults !== oldProps.tapResults || this.props.molDeskResults !== oldProps.molDeskResults) {
            const oldCols = extraAnalysisColumns(oldProps)
            const newCols = extraAnalysisColumns(this.props);
            const newDataFields = [...this.props.dataFields];


            const columnDefsByName = {};
            for (const c of this.props.columnDefs) {
                columnDefsByName[c.descriptor] = c;
            }

            for (const c of newCols) {
                if (!oldCols.has(c) && newDataFields.indexOf(c) < 0 && columnDefsByName[c]?.showByDefault) newDataFields.push(c);
            }
            if (newDataFields.length > this.props.dataFields.length) {
                this.setState({
                    dataFields: newDataFields
                });
            }
        }

        const hosting = isTamarindCompute();
        if (canStartAutomaticAlignment(this.props, hosting)) {
            const msaColumns = this.props.seqColumns.map(({column: c}) => {
                let aliColName = '_gyde_msa_' + c;
                while (this.props.columnarData[aliColName]) aliColName += 'Z';
                return {
                    column: aliColName,
                    numbering: []
                };
            })
            // Prevent re-running MSA.
            this.setState({
                msaColumns,
                mafftPending: true,
                error: undefined
            });

            (async () => {
                try {
                    const seqsToAlign = this.getSequenceData(this.props).map(({data: seqs}) => prepareSequencesColumnar(this.props.columnarData, seqs));
                    let aligns = await Promise.all(seqsToAlign.map((s) => mafftAlign(this.props.slivkaService, s)));
                    aligns = aligns.map((a, i) => matchAlign(a, seqsToAlign[i]));

                    const realMsaColumns = [];
                    const addColumns = {};
                    for (let i = 0; i < this.props.seqColumns.length; ++i) {
                         const aliColName = msaColumns[i].column;

                         // Re-insert blank entries for any missing sequences.
                         const align = aligns[i];
                         let alignCursor = 0;
                         const alignColumn = this.props.columnarData[this.props.seqColumns[i].column].map((seq) => seq ? align[alignCursor++].seq : '');

                         addColumns[aliColName] = alignColumn
                         realMsaColumns.push({
                            column: aliColName,
                            numbering: align.residueNumbers || []
                         })
                    }

                    this.setState((oldState) => ({
                        columnarData: {...oldState.columnarData, ...addColumns},
                        msaColumns: realMsaColumns,
                        mafftPending: false,
                        error: undefined
                    }));
                } catch (err) {
                    this.setState({
                        msaColumns: null,
                        mafftPending: false,
                        error: err.message || err
                    })
                }
            })();
        }

        // update heatmap data
        if (!!this.props.columnarData && oldProps.columnarData) {
            const heatmapDataColumn = this.props.columnarData[this.props.heatmapSelectedColumn];
            const oldHeatmapDataColumn = oldProps.columnarData[oldProps.heatmapSelectedColumn];

            if (this.props.filter !== oldProps.filter ||
                this.props.tableFilters !== oldProps.tableFilters ||
                this.props.heatmapHideFiltered !== oldProps.heatmapHideFiltered ||
                this.props.heatmapSelectedColumn !== oldProps.heatmapSelectedColumn ||
                heatmapDataColumn !== oldHeatmapDataColumn ||
                this.props.alignmentKey !== oldProps.alignmentKey ||
                this.getHeatmapDataScale(this.props) !== this.getHeatmapDataScale(oldProps) ||
                this.props.heatmapRelativeToWT !== oldProps.heatmapRelativeToWT ||
                this.props.explicitReference !== oldProps.explicitReference || 
                !arrayCmp(this.getAlignmentsData(this.props)?.map((x) => x?.data), this.getAlignmentsData(oldProps)?.map((x) => x?.data)) ||
                !arrayCmp(Object.keys(this.props.matrixDataObject), Object.keys(oldProps.matrixDataObject)) ||
                !arrayCmp(this.props.stagedMutations.map((m) => m.name), oldProps.stagedMutations.map((m) => m.name))
            ) { 
                this.updateHeatmapDataObject();
            }
        }

        if ((this.props.acceptedVariants || []).length > 0 && (oldProps.acceptedVariants || []).length === 0) {
            this.shoppingCartRef.current?.scrollIntoView({behavior: 'smooth'});
        }

        if ((oldProps.isVariantSelectionActive || oldProps.acceptedVariants.length > 0) && !(this.props.isVariantSelectionActive || this.props.acceptedVariants.length > 0)) {
            this.setState((oldState) => this._doUpdateLayout(oldState));
        }
    }

    getHeatmapDataScales(props) {
        if (props.heatmapRelativeToWT) {
            return ['fold change', '-fold change'];
        } else {
            return ['linear', '-linear', 'logarithmic', '-logarithmic'];
        }
    }

    getHeatmapDataScale(props) {
        const scales = this.getHeatmapDataScales(props);
        const scale = props.heatmapDataScale;
        if (scales && scales.indexOf(scale) >= 0) return scale;
        return scales[0];
    }

    updateHeatmapDataObject() {
        const {
            matrixDataObject, heatmapSelectedColumn, seqColumns, columnarData,
            tableFilters, heatmapRelativeToWT, heatmapHideFiltered, stagedMutations
        } = this.props;
        const heatmapDataScale = this.getHeatmapDataScale(this.props);
        const explicitReference = this.getExplicitReference(this.props.explicitReference, columnarData._gyde_rowid);

        const isFrequencies = heatmapSelectedColumn === '__gyde_frequencies__'
        const isColumnar = !isFrequencies && (!Object.keys(matrixDataObject).includes(heatmapSelectedColumn));
        
        const alignments = this.getAlignments();
        const references = this.getReferences();
        const newHeatmapDataObject = {};
        

        const {dataRows, viewColumnarData} = this.getViewData();
        const filter = heatmapHideFiltered 
            ? applyTableFilters(viewColumnarData, dataRows, tableFilters || {},  this.getFilterIndices(this.props.filter, columnarData._gyde_rowid)) 
            : undefined;

        let min = 1e100, max = -1e100;
        let cumulativeLength = 0;

        alignments.forEach((alignment, index) => {
            const reference = references[index];
            const data = alignment.map((seq, seqIndex) => {
                const ar = {seq};
                if (reference && reference[seqIndex]) ar.germLine = reference[seqIndex];
                return ar;
            });

            const seqLength = (data[0]?.seq ?? '').length;
        
            const key = seqColumns[index].column;
            newHeatmapDataObject[key] = new HeatmapData();

            if (isFrequencies) {
                newHeatmapDataObject[key].parseAlignmentData(
                    data, 1, filter, heatmapDataScale, heatmapRelativeToWT, explicitReference, true
                );
            } else if (isColumnar) {
                const heatmapDataColumn = columnarData[heatmapSelectedColumn];

                newHeatmapDataObject[key].parseAlignmentData(
                    data, heatmapDataColumn, filter, heatmapDataScale, heatmapRelativeToWT, explicitReference
                );
            } else {
                newHeatmapDataObject[key].parseMatrixData(
                    matrixDataObject[heatmapSelectedColumn][index], 0, seqLength, data
                )
            }

            const filteredStagedMutations = stagedMutations.filter((mutant) => mutant.colName === key)
            newHeatmapDataObject[key].updateHighlightedCells(filteredStagedMutations);

            const {minVal, maxVal} = newHeatmapDataObject[key];
            if (minVal !== null) min = Math.min(min, minVal);
            if (maxVal !== null) max = Math.max(max, maxVal);

            cumulativeLength += seqLength
        });

        if (heatmapDataScale?.startsWith('-') && !heatmapRelativeToWT) {
            const t = min;
            min = max;
            max = t;
        }

        alignments.forEach((alignment, index) => {
            const key = seqColumns[index].column;
            newHeatmapDataObject[key].normalizeData(min, max, heatmapDataScale, heatmapRelativeToWT);
        });

        this.setState({heatmapDataObject: newHeatmapDataObject});
    }

    setState(transition) {
        // NB this component has no state of its own, instead state transitions delegate to the
        // parent.

        this.props.updateTabProps(transition);
    }

    updateSortField(field) {
        this.setState((oldState) => {
            const oldSort = oldState.sortField;
            
            if (oldSort === null) {
                return {sortField: field};
            } else if (oldSort === field) {
                return {sortField: '-' + field}
            } else {
                return {sortField: null};
            }
        });
    }

    componentDidMount() {
        const {alignmentTarget, alignmentTargets} = this.props;

        if (this.getAlignments()) {
            this.setDefaultSelection();

            if (this.props.isHeatmapVisible) this.updateHeatmapDataObject();
        }

        // Fallback: if the alignment target isn't found (probably because it's "_seed") we still want to
        // run Absolve to get CDRs and numbering.
        if (this.props.storedAlignment !== alignmentTarget && this.props.isAntibody) {
            const realAlignmentTarget = alignmentTarget?.startsWith('_seed+') ? alignmentTarget.substring(6) : alignmentTarget;
            const target = alignmentTargets?.filter(({name}) => name === realAlignmentTarget)[0] || alignmentTargets?.[0];
            if (target) {
                this.runNumberingAlignment(target.name, target.aligner, alignmentTarget, target.numberingOnly)
            }
        }

        window.scrollTo(0, 0);
    }

    async runNumberingAlignment(name, aligner, alignmentKey, numberingOnly=false) {
        this.setState((oldState) => {
            const update = {
                storedAlignment: null,
                abNumError: undefined
            }

            if (oldState.abNumColumns) {
                const newData = {...oldState.columnarData};
                for (const {column} of oldState.abNumColumns) {
                    delete newData[column];
                }
                update.columnarData = newData;
                update.abNumColumns = undefined;
            }
            return update;
        });

        try {
            const seqData = this.getSequenceData(this.props);
            const hcIndex = seqData.findIndex(({column}) => column === this.props.hcColumn),
                  lcIndex = seqData.findIndex(({column}) => column === this.props.lcColumn);

            let result = await aligner(
                this.props.slivkaService,
                [...(hcIndex >= 0 ? prepareSequencesColumnar(this.props.columnarData, seqData[hcIndex].data, '_heavy') : []),
                 ...(lcIndex >= 0 ? prepareSequencesColumnar(this.props.columnarData, seqData[lcIndex].data, '_light') : [])
            ]);

            const germlines = [];
            for (const ali of result) {
                if (ali.germLine && ali.germLineRecombined) {
                  // Do this for every sequence, since even if the germ line genes match, the spacer
                  // size could be different...
                  germlines.push({
                      name: `__gl_${ali.seqName}`,
                      seq: ali.germLineRecombined
                  });
                }
            }

            if (germlines.length > 0) {
                const germlineResult = await aligner(this.props.slivkaService, germlines);
                result = [...result, ...germlineResult]
            }

            const heavyResults = result
                    .filter(({seqName}) => seqName.indexOf('_heavy') >= 0)
                    .map(({seqName, ...rest}) => ({seqName: seqName.replace('_heavy', ''), ...rest}));

            const lightResults = result
                    .filter(({seqName}) => seqName.indexOf('_light') >= 0)
                    .map(({seqName, ...rest}) => ({seqName: seqName.replace('_light', ''), ...rest}));

            let heavyAlign = anarciMakeAlign(heavyResults);
            let lightAlign = anarciMakeAlign(lightResults);

            function alignReplaceGL(align) {
                const gls = {};
                for (const seq of align) {
                    if (seq.name.startsWith('__gl_')) {
                        gls[seq.name.substring(5)] = seq;
                    }
                }

                const newAlign = align.filter(({name}) => !name.startsWith('__gl_'))
                    .map((seq) => ({
                        ...seq,
                        germLine: gls[seq.name]?.seq
                    }));
                newAlign.residueNumbers = align.residueNumbers;
                return newAlign;
            }

            if (germlines.length > 0) {
                heavyAlign = alignReplaceGL(heavyAlign);
                lightAlign = alignReplaceGL(lightAlign);
            }

            const template = prepareSequencesColumnar(this.props.columnarData, hcIndex >= 0 ? seqData[hcIndex].data : seqData[lcIndex].data, '', true);
            if (lightAlign.length > 0) lightAlign = matchAlign(lightAlign, template);
            if (heavyAlign.length > 0) heavyAlign = matchAlign(heavyAlign, template);

            let abNumRefColumns;
            const addColumns = {};

            if (!alignmentKey || (numberingOnly && alignmentKey !== '_seed')) {
                abNumRefColumns = undefined;
            } else if (alignmentKey === '_seed') {
                function extractSeedAlign(align, columnarData, nameColumn, refNameColumn) {
                    const names = columnarData[nameColumn] || [],
                          seeds = columnarData[refNameColumn] || [];
                    const index = {};
                    names.forEach((name, i) => {
                        index[name] = i;
                    });

                    return align.map((a, seqIndex) => {
                        if (seeds[seqIndex] && index[seeds[seqIndex]] !== undefined) {
                            return align[index[seeds[seqIndex]]];
                        }
                        return null;
                    });
                }

                const seedHeavy = extractSeedAlign(heavyAlign, this.props.columnarData, this.props.nameColumn, this.props.refNameColumn);
                const seedLight = extractSeedAlign(lightAlign, this.props.columnarData, this.props.nameColumn, this.props.refNameColumn);

                addColumns._gyde_abNumRefHeavy = seedHeavy.map(s => s?.seq)
                addColumns._gyde_abNumRefLight = seedLight.map(s => s?.seq)
                abNumRefColumns = this.props.seqColumns.map(({column: colName}) => {
                    if (colName === this.props.hcColumn) return {column: '_gyde_abNumRefHeavy', numbering: heavyAlign?.residueNumbers};
                    if (colName === this.props.lcColumn) return {column: '_gyde_abNumRefLight', numbering: lightAlign?.residueNumbers};
                    return null;
                });
            } else if (alignmentKey.startsWith('_seed+')) {
                const names = this.props.columnarData[this.props.nameColumn] || [],
                      seeds = this.props.columnarData[this.props.refNameColumn] || [];
                const seedIndexes = {};
                names.forEach((n, i) => {
                    seedIndexes[n] = i;
                });
                const swizzle = seeds.map((s, i) => seedIndexes[s] ?? -1);

                function swizzleAligns(aligns) {
                    return aligns?.map((a, i) => aligns[swizzle[i]]);
                }

                addColumns._gyde_abNumRefHeavy = swizzleAligns(heavyAlign.map(({germLine}) => germLine));
                addColumns._gyde_abNumRefLight = swizzleAligns(lightAlign.map(({germLine}) => germLine));
                abNumRefColumns = this.props.seqColumns.map(({column: colName}) => {
                    if (colName === this.props.hcColumn) return {column: '_gyde_abNumRefHeavy', numbering: heavyAlign?.residueNumbers};
                    if (colName === this.props.lcColumn) return {column: '_gyde_abNumRefLight', numbering: lightAlign?.residueNumbers};
                    return null;
                });
            } else {
                addColumns._gyde_abNumRefHeavy = heavyAlign.map(({germLine}) => germLine);
                addColumns._gyde_abNumRefLight = lightAlign.map(({germLine}) => germLine);
                abNumRefColumns = this.props.seqColumns.map(({column: colName}) => {
                    if (colName === this.props.hcColumn) return {column: '_gyde_abNumRefHeavy', numbering: heavyAlign?.residueNumbers};
                    if (colName === this.props.lcColumn) return {column: '_gyde_abNumRefLight', numbering: lightAlign?.residueNumbers};
                    return null;
                });
            }
            
            const abNumColumns = this.props.seqColumns.map(({column: colName}) => {
                if (colName === this.props.hcColumn) return {column: '_gyde_abNumHeavy', numbering: heavyAlign?.residueNumbers};
                if (colName === this.props.lcColumn) return {column: '_gyde_abNumLight', numbering: lightAlign?.residueNumbers};
                return null;
            });

            this.setState((oldState) => {
                const newDataColumns = [...oldState.dataColumns];
                if (germlines.length && newDataColumns.indexOf('lineage_heavy') < 0) newDataColumns.push('lineage_heavy');
                if (germlines.length && newDataColumns.indexOf('lineage_light') < 0) newDataColumns.push('lineage_light');

                return {
                    columnarData: {
                        ...oldState.columnarData,
                        _gyde_abNumHeavy: heavyAlign.map(({seq}) => seq),
                        _gyde_abNumLight: lightAlign.map(({seq}) => seq),
                        lineage_heavy: heavyResults.map((r) => r.germLine),
                        lineage_light: lightResults.map((r) => r.germLine),
                        ...addColumns
                    },
                    storedAlignment: alignmentKey,
                    abNumColumns,
                    abNumRefColumns,
                    dataColumns: newDataColumns
                };
            })
        } catch (err) {
            console.log('numbering alignment failed', err)
            this.setState({
                abNumError: err
            });
        }


    }

    plotSetter(index) {
        if (!this._plotSetters[index]) {
            this._plotSetters[index] = (transition) => {
                this.setState((oldState) => {
                    const newPlots = [...oldState.plots];
                    if (transition instanceof Function) {
                        newPlots[index] = {...oldState.plots[index], ...transition(oldState.plots[index])};
                    } else {
                        newPlots[index] = {...oldState.plots[index], ...transition}
                    }
                    return {plots: newPlots};
                });
            }
        }
        return this._plotSetters[index];
    }

    runMolDesk() {
        const selection = this.getSelectionIndices(this.props.selection, this.props.columnarData._gyde_rowid) || new Set();
        if (selection.length === 0) return;
        if (!window.confirm(`Run MolDesk on ${selection.size} sequences?  This may use considerable compute resources.`)) return;

        this.props.pinger('analysis.moldesk');

        const started = [];
        for (const did of selection) {
            if (!(this.props.mdStatus || {})[did]) {
                this.doRunMolDesk(this.props, did);
                started.push(did);
            }
        }

        this.setState((oldState) => {
            const mdStatus = {...oldState.mdStatus};
            for (const d of started) {
                if (!mdStatus[d]) {
                    mdStatus[d] = 'running';
                }
            }
            return {mdStatus};
        });
    }

    async doRunMolDesk(props, did) {
        try {
            const struct = await predictedStructureABB(
                this.props.slivkaService,
                props.hcColumn && props.columnarData[props.hcColumn][did],
                props.lcColumn && props.columnarData[props.lcColumn][did]
            );
            const mdResults = await molDesk(this.props.slivkaService, struct, 6.0);

            this.updateDatumKV(did, mdResults);
            this.setState((oldState) => ({
                mdStatus: {...oldState.mdStatus, [did]: 'done'}
            }));
        } catch (err) {
            console.log('*** MolDesk error', err);
            this.setState((oldState) => ({
                mdStatus: {...oldState.mdStatus, [did]: 'error'}
            }));
        }
    }

    runTAP() {
        const selection = this.getSelectionIndices(this.props.selection, this.props.columnarData._gyde_rowid) || new Set();
        if (selection.length === 0) return;
        if (!window.confirm(`Run TAP on ${selection.size} sequences?  This may use considerable compute resources.`)) return;

        this.props.pinger('analysis.tap');

        const started = [];
        for (const did of selection) {
            if (!(this.props.tapStatus || {})[did]) {
                this.doRunTAP(this.props, did);
                started.push(did);
            }
        }

        this.setState((oldState) => {
            const tapStatus = {...oldState.tapStatus};
            for (const d of started) {
                if (!tapStatus[d]) {
                    tapStatus[d] = 'running';
                }
            }
            return {tapStatus};
        });
    }

    async doRunTAP(props, did) {
        try {
            const tapResults = await therapeuticAntibodyProfiler(
                this.props.slivkaService,
                props.hcColumn && props.columnarData[props.hcColumn][did],
                props.lcColumn && props.columnarData[props.lcColumn][did]
            );

            this.updateDatumKV(did, tapResults);
            this.setState((oldState) => ({
                tapStatus: {...oldState.tapStatus, [did]: 'done'}
            }));
        } catch (err) {
            console.log('*** TAP error', err);
            this.setState((oldState) => ({
                tapStatus: {...oldState.tapStatus, [did]: 'error'}
            }));
        }
    }

    humanizeAction() {
        const {columnarData} = this.props;
        const selection = this.getSelectionIndices(this.props.selection, this.props.columnarData._gyde_rowid) || new Set();
        const selectionIndices = selection ? Array.from(selection) : [];
        if (selectionIndices.length !== 1) {
            alert('Select one sequence');
            return;
        }
        if (this.props.alignmentKey !== 'anarciSeqs') {
            alert('Humanize only available in "Kabat numbering" mode, at least for now.');
            return;
        }

        this.props.pinger('analysis.humanize');

        const index = selectionIndices[0];
        const get = (col) => (columnarData[col] || [])[index];

        const alignments = this.getAlignments(),
              germlines = this.getReferences(),
              hcColumnIndex = this.props.seqColumns.findIndex(({column}) => column === this.props.hcColumn),
              lcColumnIndex = this.props.seqColumns.findIndex(({column}) => column === this.props.lcColumn);

        const newHeavy = humanize(alignments[hcColumnIndex][index], germlines[hcColumnIndex][index], 'H', alignments[hcColumnIndex].residueNumbers, this.props.cdrPos, this.props.vernierPos),
              newLight = humanize(alignments[lcColumnIndex][index], germlines[lcColumnIndex][index], 'L', alignments[lcColumnIndex].residueNumbers, this.props.cdrPos, this.props.vernierPos);

        let abNumAltColumns = this.props.abNumAltColumns;
        if (!abNumAltColumns) {
            abNumAltColumns = this.props.seqColumns.map((s) => `_gyde_abNumAlt_${s.column}`);
            this.setState({abNumAltColumns});
        }

        this.addDataKV({
            name: 'human-' + get(this.props.nameColumn),
            [this.props.nameColumn]: 'human-' + get(this.props.nameColumn),
            [this.props.seqColumns[hcColumnIndex].column]: newHeavy.seq.replace(/-/g, ''),
            [this.props.seqColumns[lcColumnIndex].column]: newLight.seq.replace(/-/g, ''),
            [this.props.abNumColumns[hcColumnIndex].column]: newHeavy.seq,
            [this.props.abNumColumns[lcColumnIndex].column]: newLight.seq,
            [this.props.abNumRefColumns[hcColumnIndex].column]: get(this.props.abNumRefColumns[hcColumnIndex].column),
            [this.props.abNumRefColumns[lcColumnIndex].column]: get(this.props.abNumRefColumns[lcColumnIndex].column),
            [abNumAltColumns[hcColumnIndex]]: newHeavy.alternatives,
            [abNumAltColumns[lcColumnIndex]]: newLight.alternatives,
            noFetchStructure: true
        });

        if (this.sequenceTable) {
            this.sequenceTable.scrollIntoView(this.props.dataRowCount);
        }
    }

    toggleAlternateAction(chain, index, alt) {
        // This potentially needs fixing if we ever support humanization on "isDNA" datasets.

        const chainIndex = this.props.seqColumns.findIndex(({column}) => column === chain);
        if (chainIndex < 0) throw Error('Unexpected chain ' + chain);

        this.setState((oldState) => {
            const newColumnarData = {...oldState.columnarData};
            const abNumColumn = oldState.abNumColumns[chainIndex].column;
            const seqColumn = oldState.seqColumns[chainIndex].column;
            newColumnarData[abNumColumn] = [...newColumnarData[abNumColumn]];
            newColumnarData[seqColumn] = [...newColumnarData[seqColumn]];

            const aliSeq = newColumnarData[abNumColumn][index].split('');
            aliSeq[alt.position-1] = alt.options[(alt.options.indexOf(aliSeq[alt.position-1])+1)%alt.options.length];
            newColumnarData[abNumColumn][index] = aliSeq.join('');
            newColumnarData[seqColumn][index] = newColumnarData[abNumColumn][index].replace(/-/g, '');

            return {columnarData: newColumnarData};
        });
    }

    toggleMSADataField(fieldName, action=null) {
        this.setState((oldState) => {
            const newMDF = [...(oldState.msaTableColumns || [])];
            const i = newMDF.indexOf(fieldName);
            if (action === null) {
                if (i >= 0) {
                    action = 'remove';
                } else {
                    action = 'add';
                }
            }

            if (action === 'remove') {
                if (i >= 0) newMDF.splice(i, 1);
            } else {
                if (i < 0) newMDF.push(fieldName);
            }

            return {
                msaTableColumns: newMDF
            };
        })
    }

    reorderMSADataFields(sourceIndex, destIndex) {
        this.setState((oldState) => {
            const newDF = [...(oldState.msaTableColumns || [])];
            if (sourceIndex < 0 || sourceIndex >= newDF.length || sourceIndex === destIndex) return null;
            const move = newDF.splice(sourceIndex, 1);
            newDF.splice(destIndex, 0, ...move);
            return {
                msaTableColumns: newDF
            }
        });
    }

    toggleDataField(fieldName) {
        this.setState((oldState) => {
            const newMDF = [...(oldState.dataFields || [])];
            const i = newMDF.indexOf(fieldName);
            if (i >= 0) {
                newMDF.splice(i, 1);
            } else {
                newMDF.push(fieldName);
            }
            return {
                dataFields: newMDF
            };
        })
    }

    reorderDataFields(sourceIndex, destIndex) {
        this.setState((oldState) => {
            const newDF = [...(oldState.dataFields || [])];
            if (sourceIndex < 0 || sourceIndex >= newDF.length || sourceIndex === destIndex) return null;
            const move = newDF.splice(sourceIndex, 1);
            newDF.splice(destIndex, 0, ...move);
            return {
                dataFields: newDF
            }
        })
    }

    doFilter() {
        if (this.props.selection && this.props.selection.size) {
            this.setState({filter: this.props.selection})
        }
    }

    doUnfilter() {
        this.setState((oldState) => {
            if (oldState.filter) {
                return {filter: undefined}
            } else {
                return {tableFilters: {}}
            }
        })
    }

    doColumnFilter() {
        this.setState((oldState) => ({
            columnFilter: oldState.selectedColumns?.map((s) => new Set(s || []))
        }));
    }

    doColumnUnfilter() {
        this.setState({
            columnFilter: undefined
        });
    }

    doColumnUnfilterRange(seqColumn, min, max) {
        this.setState((oldState) => {
            const seqColumnIndex = oldState.seqColumns.findIndex(({column}) => column === seqColumn);
            if (seqColumnIndex < 0) return null;
            if (!oldState.columnFilter || !oldState.columnFilter[seqColumnIndex]) return null;

            const newColumnFilter = [...oldState.columnFilter];
            newColumnFilter[seqColumnIndex] = new Set(newColumnFilter[seqColumnIndex]);
            for (let p = min; p <= max; ++p) newColumnFilter[seqColumnIndex].add(p);

            return {columnFilter: newColumnFilter};
        });
    }

    doColumnFilterByHeatmap() {
        this.setState((oldState) => {
            const {seqColumns, heatmapDataObject} = oldState;

            const columnFilter = seqColumns.map(({column}) => {
                const hd = heatmapDataObject[column];
                if (!hd) return;

                const filterSet = new Set(hd.normalized_value_matrix.flatMap((col, i) => col.some((x) => x !== null) ? [i] : []));
                if (filterSet.size > 0) return filterSet;
            });

            return {
                columnFilter
            };
        });
    }

    doColumnFilterByNonGap() {
        this.setState((oldState) => {
            const alignments = this.getAlignmentsData(oldState);

            const filter = this.getFilterIndices(oldState.filter, oldState.columnarData._gyde_rowid);
            const columnTypes = this.getColumnTypes(oldState.columnarData, oldState.dataColumns, oldState.structureKeys, oldState.columnTypes, oldState.seqColumns);

            const {viewColumnarData, dataRows} = this.getViewDataImpl(oldState.columnarData, oldState.dataRowCount);
            const filteredItems = this.applyTableFilters(viewColumnarData, dataRows, oldState.tableFilters || {}, filter);

            const columnFilter = alignments.map((ali) => {
                if (ali && ali.data) {
                    const filter = new Set();

                    for (const i of filteredItems) {
                        const a = ali.data[i];
                        if (a) {
                            for (let j = 0; j < a.length; ++j) {
                                if (a[j] && a[j] !== '-') filter.add(j);
                            }
                        }
                    }
                    return filter;
                }
            });

            return {
                columnFilter
            };
        });
    }

    doSelectAll() {
        this.setState((oldState) => {

            const {columnarData, tableFilters} = oldState;

            const {viewColumnarData, dataRows} = this.getViewDataImpl(columnarData, oldState.dataRowCount);
            const filteredItems = this.applyTableFilters(viewColumnarData, dataRows, tableFilters || {}, this.getFilterIndices(oldState.filter, oldState.columnarData._gyde_rowid));
            const rowids = oldState.columnarData._gyde_rowid;

            return {selection: new Set(Array.from(filteredItems).map((i) => rowids[i]))};
        });
    }

    doSelectNone() {
        this.setState({selection: new Set()})
    }

    doInvertSelection() {
        this.setState((oldState) => {
            const {columnarData, tableFilters} = oldState;

            const {viewColumnarData, dataRows} = this.getViewDataImpl(columnarData, oldState.dataRowCount);
            const filteredItems = this.applyTableFilters(viewColumnarData, dataRows, tableFilters || {}, this.getFilterIndices(oldState.filter, oldState.columnarData._gyde_rowid));
            const rowids = oldState.columnarData._gyde_rowid;

            const selection = new Set(Array.from(filteredItems).map((i) => rowids[i]));
            if (oldState.selection) {
                for (const s of oldState.selection) selection.delete(s);
            }

            return {selection};
        });
    }

    updateTableFilters(update) {
        this.setState((oldState) => {
            const newTableFilters = {...oldState.tableFilters, ...update};
            const removeKeys = Object.entries(newTableFilters).filter(([k, v]) => v === undefined).map(([k, v]) => k);
            for (const k of removeKeys) delete newTableFilters[k];
            return {tableFilters: newTableFilters};
        });
    }

    updateTableFormats(update) {
        this.setState((oldState) => {
            const newTableFormats = {...oldState.tableFormats, ...update};
            const removeKeys = Object.entries(newTableFormats).filter(([k, v]) => v === undefined).map(([k, v]) => k);
            for (const k of removeKeys) delete newTableFormats[k];
            return {tableFormats: newTableFormats};
        });
    }

    attachNumbers(alignment, numbers, implicit) {
        if (!alignment || alignment.length === 0) return CONSTANT_NUMBERED_EMPTY;

        if (!numbers && implicit) {
            const length = alignment.map((s) => s ? s.length : 0).reduce((a, b) => Math.max(a, b), 0);
            numbers = [];
            for (let i = 1; i <= length; ++i) numbers.push(i.toString());
        }
        const result = [...alignment];
        result.residueNumbers = numbers;
        return result;
    }

    attachNumbersA0 = memoize(this.attachNumbers);
    attachNumbersA1 = memoize(this.attachNumbers);
    attachNumbersA2 = memoize(this.attachNumbers);
    attachNumbersA3 = memoize(this.attachNumbers);
    attachNumbersA4 = memoize(this.attachNumbers);
    attachNumbersA5 = memoize(this.attachNumbers);
    attachNumbersA6 = memoize(this.attachNumbers);
    attachNumbersA7 = memoize(this.attachNumbers);
    attachNumbersA8 = memoize(this.attachNumbers);
    attachNumbersA9 = memoize(this.attachNumbers);
    attachNumbersA10 = memoize(this.attachNumbers);
    attachNumbersA11 = memoize(this.attachNumbers);
    attachNumbersA12 = memoize(this.attachNumbers);
    attachNumbersA13 = memoize(this.attachNumbers);
    attachNumbersA14 = memoize(this.attachNumbers);
    attachNumbersA15 = memoize(this.attachNumbers);
    attachNumbersA16 = memoize(this.attachNumbers);
    attachNumbersA17 = memoize(this.attachNumbers);
    attachNumbersA18 = memoize(this.attachNumbers);
    attachNumbersA19 = memoize(this.attachNumbers);
    _getSequenceData = memoize((key, isDNA, ...seqColumns) => {
        return key.map((k, i) => {
            let seqs = seqColumns[i] || [];
            if (isDNA) seqs = seqs.map((s) => {
                let tl = translateDNA(s || '');
                if (tl.length > 0 && tl[tl.length-1] === '*') tl = tl.substring(0, tl.length-1);
                return tl;
            });

            return {...k, data: seqs};
        });
    });
    getSequenceData(props) {
        const {seqColumns: key, columnarData, isDNA} = props;
        if (key) {
            return this._getSequenceData(key, isDNA, ...key.map((k) => columnarData[k.column]));
        }
    }
    getAlignmentsKey(props) {
        const keyName = props.alignmentKey || 'seqs';
        if (keyName === 'seqs') {
            return props.seqColumns;
        } else if (keyName === 'anarciSeqs') {
            return props.abNumColumns;
        } else {
            return props.msaColumns;
        }
    }
    getAlignmentsData(props) {
        const {columnarData} = props;

        const keyName = props.alignmentKey || 'seqs';
        if (keyName === 'seqs') {
            return this.getSequenceData(props);
        } else {
            let key, fallbackKey=[];
            if (keyName === 'anarciSeqs') {
                key = props.abNumColumns;
                fallbackKey = props.msaColumns;
            } else {
                key = props.msaColumns;
            }
            return key?.map((k, i) => k || fallbackKey[i])?.map((k) => ({...k, data: (k ? columnarData[k.column] : null) ?? CONSTANT_EMPTY}))
        }
    }
    getAlignments() {
        const key = this.getAlignmentsData(this.props),
              allowImplicitNumbering = this.props.alignmentKey === 'seqs';

        if (key) {
            const alignments = [];
            if (key.length > 0) {
                alignments.push(this.attachNumbersA0(key[0].data, key[0].numbering, allowImplicitNumbering));
            }
            if (key.length > 1) {
                alignments.push(this.attachNumbersA1(key[1].data, key[1].numbering, allowImplicitNumbering));
            }
            if (key.length > 2) {
                alignments.push(this.attachNumbersA2(key[2].data, key[2].numbering, allowImplicitNumbering));
            }
            if (key.length > 3) {
                alignments.push(this.attachNumbersA3(key[3].data, key[3].numbering, allowImplicitNumbering));
            }
            if (key.length > 4) {
                alignments.push(this.attachNumbersA4(key[4].data, key[4].numbering, allowImplicitNumbering));
            }
            if (key.length > 5) {
                alignments.push(this.attachNumbersA5(key[5].data, key[5].numbering, allowImplicitNumbering));
            }
            if (key.length > 6) {
                alignments.push(this.attachNumbersA6(key[6].data, key[6].numbering, allowImplicitNumbering));
            }
            if (key.length > 7) {
                alignments.push(this.attachNumbersA7(key[7].data, key[7].numbering, allowImplicitNumbering));
            }
            if (key.length > 8) {
                alignments.push(this.attachNumbersA8(key[8].data, key[8].numbering, allowImplicitNumbering));
            }
            if (key.length > 9) {
                alignments.push(this.attachNumbersA9(key[9].data, key[9].numbering, allowImplicitNumbering));
            }
            if (key.length > 10) {
                alignments.push(this.attachNumbersA10(key[10].data, key[10].numbering, allowImplicitNumbering));
            }
            if (key.length > 11) {
                alignments.push(this.attachNumbersA11(key[11].data, key[11].numbering, allowImplicitNumbering));
            }
            if (key.length > 12) {
                alignments.push(this.attachNumbersA12(key[12].data, key[12].numbering, allowImplicitNumbering));
            }
            if (key.length > 13) {
                alignments.push(this.attachNumbersA13(key[13].data, key[13].numbering, allowImplicitNumbering));
            }
            if (key.length > 14) {
                alignments.push(this.attachNumbersA14(key[14].data, key[14].numbering, allowImplicitNumbering));
            }
            if (key.length > 15) {
                alignments.push(this.attachNumbersA15(key[15].data, key[15].numbering, allowImplicitNumbering));
            }
            if (key.length > 16) {
                alignments.push(this.attachNumbersA16(key[16].data, key[16].numbering, allowImplicitNumbering));
            }
            if (key.length > 17) {
                alignments.push(this.attachNumbersA17(key[17].data, key[17].numbering, allowImplicitNumbering));
            }
            if (key.length > 18) {
                alignments.push(this.attachNumbersA18(key[18].data, key[18].numbering, allowImplicitNumbering));
            }
            if (key.length > 19) {
                alignments.push(this.attachNumbersA19(key[19].data, key[19].numbering, allowImplicitNumbering));
            }
            if (key.length > 20) {
                throw Error('fixme');
            }
            return this._alignmentsArray(...alignments);
        } else {
            return this._alignmentsArray();
        }
    }
    _alignmentsArray = memoize((...alis) => alis);

    attachNumbersR0 = memoize(this.attachNumbers);
    attachNumbersR1 = memoize(this.attachNumbers);
    attachNumbersR2 = memoize(this.attachNumbers);
    attachNumbersR3 = memoize(this.attachNumbers);
    attachNumbersR4 = memoize(this.attachNumbers);
    attachNumbersR5 = memoize(this.attachNumbers);
    attachNumbersR6 = memoize(this.attachNumbers);
    attachNumbersR7 = memoize(this.attachNumbers);
    attachNumbersR8 = memoize(this.attachNumbers);
    attachNumbersR9 = memoize(this.attachNumbers);
    attachNumbersR10 = memoize(this.attachNumbers);
    attachNumbersR11 = memoize(this.attachNumbers);
    attachNumbersR12 = memoize(this.attachNumbers);
    attachNumbersR13 = memoize(this.attachNumbers);
    attachNumbersR14 = memoize(this.attachNumbers);
    attachNumbersR15 = memoize(this.attachNumbers);
    attachNumbersR16 = memoize(this.attachNumbers);
    attachNumbersR17 = memoize(this.attachNumbers);
    attachNumbersR18 = memoize(this.attachNumbers);
    attachNumbersR19 = memoize(this.attachNumbers);


    projectSeedAlignment(align, columnarData) {
        const names = columnarData[this.props.nameColumn] || [],
              seeds = columnarData[this.props.refNameColumn] || [];
        const index = {};
        names.forEach((name, i) => {
            index[name] = i;
        });

        const seedAlign = align.map((a, seqIndex) => {
            if (seeds[seqIndex] && index[seeds[seqIndex]] !== undefined) {
                return align[index[seeds[seqIndex]]];
            }
            return null;
        });
        seedAlign.residueNumbers = align.residueNumbers;
        return seedAlign;
    }
    projectSeedAlignmentR0 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR1 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR2 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR3 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR4 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR5 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR6 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR7 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR8 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR9 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR10 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR11 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR12 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR13 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR14 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR15 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR16 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR17 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR18 = memoize(this.projectSeedAlignment);
    projectSeedAlignmentR19 = memoize(this.projectSeedAlignment);

    getReferencesKey(props) {
        const keyName = props.alignmentKey || 'seqs';
        if (keyName === 'seqs') {
            if (!props.suppressDatasetReference) {
                return props.seqRefColumns;
            }
        } else if (keyName === 'anarciSeqs') {
            return props.abNumRefColumns;
        } else {
            return props.msaRefColumns;
        }
    }
    getReferences() {
        if (this.props.explicitReference) {
            return this.getExplicitReferences();
        }
        const key = this.getReferencesKey(this.props),
              allowImplicitNumbering = this.props.alignmentKey === 'seqs';

        if (!key && this.props.alignmentKey !== 'anarciSeqs' && this.props.abNumColumns && this.props.abNumRefColumns) {
            return this.getProjectedAbNumReferences(this.props.alignmentKey, this.props.abNumColumns, this.props.abNumRefColumns, this.props.columnarData);
        }

        if (key) {
            const alignments = [];
            if (key.length > 0) {
                alignments.push(this.attachNumbersR0(this.props.columnarData[key[0]?.column], key[0]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 1) {
                alignments.push(this.attachNumbersR1(this.props.columnarData[key[1]?.column], key[1]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 2) {
                alignments.push(this.attachNumbersR2(this.props.columnarData[key[2]?.column], key[2]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 3) {
                alignments.push(this.attachNumbersR3(this.props.columnarData[key[3]?.column], key[3]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 4) {
                alignments.push(this.attachNumbersR4(this.props.columnarData[key[4]?.column], key[4]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 5) {
                alignments.push(this.attachNumbersR5(this.props.columnarData[key[5]?.column], key[5]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 6) {
                alignments.push(this.attachNumbersR6(this.props.columnarData[key[6]?.column], key[6]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 7) {
                alignments.push(this.attachNumbersR7(this.props.columnarData[key[7]?.column], key[7]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 8) {
                alignments.push(this.attachNumbersR8(this.props.columnarData[key[8]?.column], key[8]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 9) {
                alignments.push(this.attachNumbersR9(this.props.columnarData[key[9]?.column], key[9]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 10) {
                alignments.push(this.attachNumbersR10(this.props.columnarData[key[10]?.column], key[10]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 11) {
                alignments.push(this.attachNumbersR11(this.props.columnarData[key[11]?.column], key[11]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 12) {
                alignments.push(this.attachNumbersR12(this.props.columnarData[key[12]?.column], key[12]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 13) {
                alignments.push(this.attachNumbersR13(this.props.columnarData[key[13]?.column], key[13]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 14) {
                alignments.push(this.attachNumbersR14(this.props.columnarData[key[14]?.column], key[14]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 15) {
                alignments.push(this.attachNumbersR15(this.props.columnarData[key[15]?.column], key[15]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 16) {
                alignments.push(this.attachNumbersR16(this.props.columnarData[key[16]?.column], key[16]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 17) {
                alignments.push(this.attachNumbersR17(this.props.columnarData[key[17]?.column], key[17]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 18) {
                alignments.push(this.attachNumbersR18(this.props.columnarData[key[18]?.column], key[18]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 19) {
                alignments.push(this.attachNumbersR19(this.props.columnarData[key[19]?.column], key[19]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 20) {
                throw Error('fixme');
            }
            return this._referencesArray(...alignments);
        } else if (this.props.columnarData[this.props.refNameColumn] && this.props.columnarData[this.props.nameColumn]) {
            const alignments = this.getAlignments();
            const references = [];
            if (alignments.length > 0) {
                references.push(this.projectSeedAlignmentR0(alignments[0], this.props.columnarData));
            }
            if (alignments.length > 1) {
                references.push(this.projectSeedAlignmentR1(alignments[1], this.props.columnarData));
            }
            if (alignments.length > 2) {
                references.push(this.projectSeedAlignmentR2(alignments[2], this.props.columnarData));
            }
            if (alignments.length > 3) {
                references.push(this.projectSeedAlignmentR3(alignments[3], this.props.columnarData));
            }
            if (alignments.length > 4) {
                references.push(this.projectSeedAlignmentR4(alignments[4], this.props.columnarData));
            }
            if (alignments.length > 5) {
                references.push(this.projectSeedAlignmentR5(alignments[5], this.props.columnarData));
            }
            if (alignments.length > 6) {
                references.push(this.projectSeedAlignmentR6(alignments[6], this.props.columnarData));
            }
            if (alignments.length > 7) {
                references.push(this.projectSeedAlignmentR7(alignments[7], this.props.columnarData));
            }
            if (alignments.length > 8) {
                references.push(this.projectSeedAlignmentR8(alignments[8], this.props.columnarData));
            }
            if (alignments.length > 9) {
                references.push(this.projectSeedAlignmentR9(alignments[9], this.props.columnarData));
            }
            if (alignments.length > 10) {
                references.push(this.projectSeedAlignmentR10(alignments[10], this.props.columnarData));
            }
            if (alignments.length > 11) {
                references.push(this.projectSeedAlignmentR11(alignments[11], this.props.columnarData));
            }
            if (alignments.length > 12) {
                references.push(this.projectSeedAlignmentR12(alignments[12], this.props.columnarData));
            }
            if (alignments.length > 13) {
                references.push(this.projectSeedAlignmentR13(alignments[13], this.props.columnarData));
            }
            if (alignments.length > 14) {
                references.push(this.projectSeedAlignmentR14(alignments[14], this.props.columnarData));
            }
            if (alignments.length > 15) {
                references.push(this.projectSeedAlignmentR15(alignments[15], this.props.columnarData));
            }
            if (alignments.length > 16) {
                references.push(this.projectSeedAlignmentR16(alignments[16], this.props.columnarData));
            }
            if (alignments.length > 17) {
                references.push(this.projectSeedAlignmentR17(alignments[17], this.props.columnarData));
            }
            if (alignments.length > 18) {
                references.push(this.projectSeedAlignmentR18(alignments[18], this.props.columnarData));
            }
            if (alignments.length > 19) {
                references.push(this.projectSeedAlignmentR19(alignments[19], this.props.columnarData));
            }
            if (alignments.length > 20) {
                throw Error('fixme');
            }
            return this._referencesArray(...references);
        }

        return this._referencesArray();
    }
    _referencesArray = memoize((...alis) => alis);

    getProjectedAbNumReferences = memoize((alignmentKey, abNumColumns, abNumRefColumns, columnarData) => {
        const alignments = this.getAlignments();
        return alignments.map((a, i) => {
            const abNumSeqs = columnarData[abNumColumns[i].column] || [],
                  abNumRefSeqs = columnarData[abNumRefColumns[i].column] || []
            const ref = a.map((seq, j) => {
                const abNumSeq = abNumSeqs[j],
                      abNumRefSeq = abNumRefSeqs[j];

                if (!abNumSeq || !abNumRefSeq) return null;

                const flatRef = [];
                for (let p = 0; p < abNumRefSeq.length; ++p) {
                    if (abNumSeq[p] && abNumSeq[p] !== '-') flatRef.push(abNumRefSeq[p]);
                }

                const refAli = [];
                let refCursor = 0;
                for (let p = 0; p < seq.length; ++p) {
                    if (seq[i] === '-') {
                        refAli.push('-');
                    } else {
                        if (refCursor < flatRef.length) refAli.push(flatRef[refCursor]);
                        refCursor++;
                    }
                }

                return refAli.join('');
            })
            ref.residueNumbers = a.residueNumbers;
            return ref;
        });
    })

    getExplicitReferences() {
        const explicitReference = this.getExplicitReference(this.props.explicitReference, this.props.columnarData._gyde_rowid);
        const alignments = this.getAlignments();

        const references = [];
        if (alignments.length > 0) {
            references.push(this.pickExplicitReferenceR0(alignments[0], explicitReference))
        }
        if (alignments.length > 1) {
            references.push(this.pickExplicitReferenceR1(alignments[1], explicitReference))
        }
        if (alignments.length > 2) {
            references.push(this.pickExplicitReferenceR2(alignments[2], explicitReference))
        }
        if (alignments.length > 3) {
            references.push(this.pickExplicitReferenceR3(alignments[3], explicitReference))
        }
        if (alignments.length > 4) {
            references.push(this.pickExplicitReferenceR4(alignments[4], explicitReference))
        }
        if (alignments.length > 5) {
            references.push(this.pickExplicitReferenceR5(alignments[5], explicitReference))
        }
        if (alignments.length > 6) {
            references.push(this.pickExplicitReferenceR6(alignments[6], explicitReference))
        }
        if (alignments.length > 7) {
            references.push(this.pickExplicitReferenceR7(alignments[7], explicitReference))
        }
        if (alignments.length > 8) {
            references.push(this.pickExplicitReferenceR8(alignments[8], explicitReference))
        }
        if (alignments.length > 9) {
            references.push(this.pickExplicitReferenceR9(alignments[9], explicitReference))
        }
        if (alignments.length > 10) {
            references.push(this.pickExplicitReferenceR10(alignments[10], explicitReference))
        }
        if (alignments.length > 11) {
            references.push(this.pickExplicitReferenceR11(alignments[11], explicitReference))
        }
        if (alignments.length > 12) {
            references.push(this.pickExplicitReferenceR12(alignments[12], explicitReference))
        }
        if (alignments.length > 13) {
            references.push(this.pickExplicitReferenceR13(alignments[13], explicitReference))
        }
        if (alignments.length > 14) {
            references.push(this.pickExplicitReferenceR14(alignments[14], explicitReference))
        }
        if (alignments.length > 15) {
            references.push(this.pickExplicitReferenceR15(alignments[15], explicitReference))
        }
        if (alignments.length > 16) {
            references.push(this.pickExplicitReferenceR16(alignments[16], explicitReference))
        }
        if (alignments.length > 17) {
            references.push(this.pickExplicitReferenceR17(alignments[17], explicitReference))
        }
        if (alignments.length > 18) {
            references.push(this.pickExplicitReferenceR18(alignments[18], explicitReference))
        }
        if (alignments.length > 19) {
            references.push(this.pickExplicitReferenceR19(alignments[19], explicitReference))
        }


        return this._referencesArray(...references);
    }

    pickExplicitReference(alignment, explicitReference) {
        const ref = alignment.map((_) => alignment[explicitReference]);
        ref.residueNumbers = alignment.residueNumbers;
        return ref;
    }
    pickExplicitReferenceR0 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR1 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR2 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR3 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR4 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR5 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR6 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR7 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR8 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR9 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR10 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR11 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR12 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR13 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR14 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR15 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR16 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR17 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR18 = memoize(this.pickExplicitReference);
    pickExplicitReferenceR19 = memoize(this.pickExplicitReference);

    attachNumbersN0 = memoize(this.attachNumbers);
    attachNumbersN1 = memoize(this.attachNumbers);
    attachNumbersN2 = memoize(this.attachNumbers);
    attachNumbersN3 = memoize(this.attachNumbers);
    attachNumbersN4 = memoize(this.attachNumbers);
    attachNumbersN5 = memoize(this.attachNumbers);
    attachNumbersN6 = memoize(this.attachNumbers);
    attachNumbersN7 = memoize(this.attachNumbers);
    attachNumbersN8 = memoize(this.attachNumbers);
    attachNumbersN9 = memoize(this.attachNumbers);
    attachNumbersN10 = memoize(this.attachNumbers);
    attachNumbersN11 = memoize(this.attachNumbers);
    attachNumbersN12 = memoize(this.attachNumbers);
    attachNumbersN13 = memoize(this.attachNumbers);
    attachNumbersN14 = memoize(this.attachNumbers);
    attachNumbersN15 = memoize(this.attachNumbers);
    attachNumbersN16 = memoize(this.attachNumbers);
    attachNumbersN17 = memoize(this.attachNumbers);
    attachNumbersN18 = memoize(this.attachNumbers);
    attachNumbersN19 = memoize(this.attachNumbers);
    getAbNumAlignments() {
        const key = this.props.abNumColumns,
              allowImplicitNumbering = false;

        if (key) {
            const alignments = [];
            if (key.length > 0) {
                alignments.push(this.attachNumbersN0(this.props.columnarData[key[0]?.column], key[0]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 1) {
                alignments.push(this.attachNumbersN1(this.props.columnarData[key[1]?.column], key[1]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 2) {
                alignments.push(this.attachNumbersN2(this.props.columnarData[key[2]?.column], key[2]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 3) {
                alignments.push(this.attachNumbersN3(this.props.columnarData[key[3]?.column], key[3]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 4) {
                alignments.push(this.attachNumbersN4(this.props.columnarData[key[4]?.column], key[4]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 5) {
                alignments.push(this.attachNumbersN5(this.props.columnarData[key[5]?.column], key[5]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 6) {
                alignments.push(this.attachNumbersN6(this.props.columnarData[key[6]?.column], key[6]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 7) {
                alignments.push(this.attachNumbersN7(this.props.columnarData[key[7]?.column], key[7]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 8) {
                alignments.push(this.attachNumbersN8(this.props.columnarData[key[8]?.column], key[8]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 9) {
                alignments.push(this.attachNumbersN9(this.props.columnarData[key[9]?.column], key[9]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 10) {
                alignments.push(this.attachNumbersN10(this.props.columnarData[key[10]?.column], key[10]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 11) {
                alignments.push(this.attachNumbersN11(this.props.columnarData[key[11]?.column], key[11]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 12) {
                alignments.push(this.attachNumbersN12(this.props.columnarData[key[12]?.column], key[12]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 13) {
                alignments.push(this.attachNumbersN13(this.props.columnarData[key[13]?.column], key[13]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 14) {
                alignments.push(this.attachNumbersN14(this.props.columnarData[key[14]?.column], key[14]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 15) {
                alignments.push(this.attachNumbersN15(this.props.columnarData[key[15]?.column], key[15]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 16) {
                alignments.push(this.attachNumbersN16(this.props.columnarData[key[16]?.column], key[16]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 17) {
                alignments.push(this.attachNumbersN17(this.props.columnarData[key[17]?.column], key[17]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 18) {
                alignments.push(this.attachNumbersN18(this.props.columnarData[key[18]?.column], key[18]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 19) {
                alignments.push(this.attachNumbersN19(this.props.columnarData[key[19]?.column], key[19]?.numbering, allowImplicitNumbering));
            }
            if (key.length > 20) {
                throw Error('fixme');
            }
            return this._abNumAlignmentsArray(...alignments);
        } else {
            return this._abNumAlignmentsArray();
        }
    }
    _abNumAlignmentsArray = memoize((...alis) => alis);

    getAlternativesKey(props) {
        const keyName = props.alignmentKey || 'seqs';
        if (keyName === 'anarciSeqs') {
            return props.abNumAltColumns;
        }
    }
    getAlternatives() {
        const key = this.getAlternativesKey(this.props);
        if (key) {
            return this._altsArray(...(key.map((c) => this.props.columnarData[c])));
        }
        return this._altsArray();
    }
    _altsArray = memoize((...alts) => alts);

    getVisibleColumnsImpl = memoize((dataColumns, hiddenColumns, ...columnSetDescs) => {
        hiddenColumns = new Set(hiddenColumns);
        for (const csd of columnSetDescs) {
            for (const {column} of csd || []) {
                hiddenColumns.add(column);
            } 
        }

        const visibleColumns = [], visibleColumnSet = new Set();
        function add(c) {
            if (!visibleColumnSet.has(c)) {
                visibleColumnSet.add(c);
                visibleColumns.push(c);
            }
        }

        add('Names');
        for (const c of dataColumns) {
            if (c && !hiddenColumns.has(c) && !c.startsWith('_gyde')) add(c);
        }
        return visibleColumns;
    });

    _getRefSequenceData = memoize((key, isDNA, ...seqColumns) => {
        return key.map((k, i) => {
            let seqs = seqColumns[i] || [];
            if (isDNA) seqs = seqs.map((s) => {
                let tl = translateDNA(s || '');
                if (tl.length > 0 && tl[tl.length-1] === '*') tl = tl.substring(0, tl.length-1);
                return tl;
            });

            return {...k, data: seqs};
        });
    });
    getRefSequenceData(props) {
        const {seqRefColumns: key, columnarData, isDNA} = props;
        if (key) {
            return this._getRefSequenceData(key, isDNA, ...key.map((k) => k && k.column ? columnarData[k.column] : undefined));
        }
    }

    getVisibleColumns() {
        const columnSetDescs = [];
        for (const cdk of ['seqColumns', 'seqRefColumns', 'msaColumns', 'msaRefColumns', 'abNumColumns', 'abNumRefColumns']) {
            if (this.props['cdk']) columnSetDescs.push(this.props[cdk]);
        }
        return this.getVisibleColumnsImpl(this.props.dataColumns, this.props.hideColumns || [], ...columnSetDescs);
    }

    getViewDataImpl = memoize((columnarData, dataRowCount) => {
        const dataRows = [];
        for (let i = 0; i < dataRowCount; ++i) dataRows.push(i);

        const names = (() => {
            const names = [];
            const concept_name = columnarData[this.props.nameColumn] || [],
                  seqid = columnarData.seqid || [];
            for (let i = 0; i < dataRowCount; ++i) {
                names.push(concept_name[i] || seqid[i]);
            }
            return names;
        })();

        const viewColumnarData = {...this.props.columnarData, 'Names': names};

        return {dataRows, viewColumnarData};
    })

    getViewData() {
        return this.getViewDataImpl(this.props.columnarData, this.props.dataRowCount);
    }

    _makeTableFiltersSet = memoize((...items) => new Set(items));

    applyTableFilters = memoize((viewColumnarData, dataRows, tableFilters, filter) => {
        // Changing the tableFilter can have effects (e.g. in FrequencyAnalysis, so make
        // sure we only change object identity if things have *really* changed).
        const tf = applyTableFilters(viewColumnarData, dataRows, tableFilters, filter);
        return this._makeTableFiltersSet(...Array.from(tf || []));
    });

    getColumnTypes = memoize((columnarData, dataColumns, structureKeys, explicitColumnTypes={}, seqColumns=[]) => {
        seqColumns = new Set(seqColumns.map((c) => c.column));

        function t(name, vals) {
            if (explicitColumnTypes[name]) return explicitColumnTypes[name];

            if (name === 'user_ranking') {
                return 'rating';
            } else if (name === 'user_notes') {
                return 'note';
            } else if (structureKeys.indexOf(name) >= 0) {
                return  'structure';
            } else if (seqColumns.has(name)) {
                return 'protein';
            }

            let numeric = false, nonNumeric = false;
            for (const v of vals || []) {
                if (typeof(v) === 'number') {
                    numeric = true;
                } else if (v !== null && v !== undefined && v !== '-' && v !== 'NA' && v !== '#N/A') {
                    nonNumeric = true;
                }
            }

            if (numeric && !nonNumeric) {
                return 'numeric';
            } else if (nonNumeric) {
                return 'info';
            } else {
                return 'empty';
            }
        }

        const types = {};
        for (const k of new Set([...Object.keys(columnarData), ...dataColumns])) {
            types[k] = t(k, columnarData[k]);
        }

        return types;
    });

    getRowReverseIndex = memoize((rowids) => {
        const rid = {};
        rowids.forEach((r, i) => {rid[r] = i});
        return rid;
    });

    getSelectionIndices = memoize((selection, rowids) => {
        const rid = this.getRowReverseIndex(rowids);
        if (!selection) return selection;
        return new Set(Array.from(selection).map((r) => rid[r]).filter((i) => i !== undefined));
    });

    getFilterIndices = memoize((filter, rowids) => {
        const rid = this.getRowReverseIndex(rowids);
        if (!filter) return filter;
        return new Set(Array.from(filter).map((r) => rid[r]).filter((i) => i !== undefined));
    });

    getExplicitReference = memoize((explicitReference, rowids) => {
        const rid = this.getRowReverseIndex(rowids);
        if (!explicitReference) return explicitReference;
        return rid[explicitReference];
    });

    render() {
        const {loadedSessions = [], ...sessionProps} = this.props;

        const {
            isAntibody, columnarData, layout, analysisImageFields = [], allowFrequencyAnalysis,
            isVariantSelectionActive, acceptedVariants
        } = sessionProps;

        const selection = this.getSelectionIndices(this.props.selection, columnarData._gyde_rowid);

        const hasStructAnalysisSection = !!analysisImageFields.some((f) => columnarData[f]);

        const alignments = this.getAlignments();
        const {viewColumnarData,} = this.getViewData();

        const seqData = this.getSequenceData(this.props);
        const refSeqData = this.getRefSequenceData(this.props);

        const widgets = this.getWidgets();
        const layoutDict = this.getLayoutDict();

        const gridLayout = {};
        {
            let row = 1, col = 1;
            for (const wl of layout) {
                if (!widgets[wl.name]) continue;
                const cols = wl.isHalfWidth ? 1 : 2;
                if (col + cols > 3)  {
                    ++row; col = 1;
                }
                
                gridLayout[wl.name] = {
                    gridRow: row,
                    gridColumnStart: col,
                    gridColumnEnd: col + cols 
                }
                col += cols;
            }
        }

        return (
            <React.Fragment>
                <Sidebar
                    layoutDict={layoutDict}
                    updateLayout={this.updateLayout}
                    checkUpdateLayout={this.checkUpdateLayout}

                    scrollToSequenceTable={() => this.sequenceTableRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToStructure={() => this.structureRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToStructAnalysis={() => this.structAnalysisRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToPlot={() => this.plotRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToTAP={() => this.TAPRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToData={() => this.dataRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToFrequencyAnalysis={() => this.frequencyAnalysisRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToShoppingCart={() => this.shoppingCartRef.current.scrollIntoView({behavior: 'smooth'})}
                    scrollToRestraints={() => this.restraintRef.current?.scrollIntoView({behavior: 'smooth'})}

                    hasStructAnalysisSection={hasStructAnalysisSection}
                    hasFrequencyAnalysis={allowFrequencyAnalysis}
                    isAntibody={isAntibody}
                    hasShoppingCart={isVariantSelectionActive || acceptedVariants.length > 0}
                    shoppingCartSize={acceptedVariants.length}
                    hasRestraints={this.props.isRestraintUIActive}
                />

                <div style={{
                        paddingLeft: '5rem',
                        paddingRight: '0.35rem',
                        paddingTop: '0.35rem',
                        paddingBottom: '0.35rem',
                        display: 'grid',
                        gap: '1rem',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'
                     }}>
                    { Object.entries(widgets).map(([name, widget], widgetIndex) => {
                        return (
                            <div key={name} style={gridLayout[name] || {display: 'none'}}>
                                {widget}
                            </div>
                        );
                    }) }
                </div>

                <MPNNControls 
                    show={ this.props.showingMPNN }
                    onDataLoad={ this.props.onDataLoad }
                    onHide={ () => this.setState({showingMPNN: false}) }
                    seqColumns={ seqData }
                    seqColumnNames={ this.props.seqColumnNames }
                    seqRefColumns={ refSeqData }
                    selectedColumns={ this.props.selectedColumns }
                    columnarData={ this.props.columnarData }
                    nameColumn={ this.props.nameColumn }
                    selection={ selection }
                    structureKeys={ this.props.structureKeys }
                    alignments={ alignments }
                    sessionProps={ this.props }
                />

                <LigandMPNN 
                    show={ this.props.showingLigandMPNN }
                    onDataLoad={ this.props.onDataLoad }
                    onHide={ () => this.setState({showingLigandMPNN: false}) }
                    seqColumns={ seqData }
                    seqColumnNames={ this.props.seqColumnNames }
                    seqRefColumns={ refSeqData }
                    selectedColumns={ this.props.selectedColumns }
                    columnarData={ this.props.columnarData }
                    nameColumn={ this.props.nameColumn }
                    selection={ selection }
                    structureKeys={ this.props.structureKeys }
                    alignments={ alignments }
                    sessionProps={ this.props }
                />

                <AddColumn show={ this.props.showAddColumn}
                           onHide={ () => this.setState({showAddColumn: false}) }
                           existingColumns={ this.props.dataColumns }
                           onAdd={ (name, type) => {
                                this.setState((oldState) => ({
                                    columnarData: {...oldState.columnarData, [name]: []},
                                    columnTypes: {...oldState.columnTypes, [name]: type},
                                    dataColumns: [...oldState.dataColumns, name],
                                    msaTableColumns: [...(oldState.msaTableColumns || []), name],
                                    dataFields: [...oldState.dataFields, name],
                                    showAddColumn: false
                                }))
                           }} />

                <SetupMerge show={this.props.showSetupMerge} 
                            onHide={this.hideMerge}
                            loadedSessions={loadedSessions}
                            thisSession={sessionProps}
                            onDataLoad={this.props.onDataLoad}
                            updateTab={this.setState} />

                <JobViewDialog {...(this.props.viewingJob || {})}
                               onHide={() => this.setState({viewingJob: undefined})} />
                <SelectByIndex show={this.props.showSelectByIndex}
                               onHide={this.hideSelectByIndex}
                               seqColumns={ seqData }
                               seqColumnNames={ this.props.seqColumnNames }
                               updateSelectedColumns={ this.updateSelectedColumns }
                               seqRefColumns={ refSeqData }
                               selectedColumns={ this.props.selectedColumns }
                               columnarData={ this.props.columnarData }
                               selection={ selection }
                               structureKeys={ this.props.structureKeys }
                               alignments={ alignments } />

            </React.Fragment>
        )
    }

    getWidgets() {
        const {error, abNumError, alignmentKey, plots = [], columnDefs, colourSchemeKey, 
            highlightCDRs, colourBackground, typefaceName, alignmentTarget, alignmentTargets, 
            plotRows, plotCols, isAntibody, tableFilters, wasHumanized, specialAlign, 
            isSequenceLogoVisible, isHeatmapVisible, heatmapSelectedColumn, hasSeeds, dataFields, 
            columnarData, heatmapRelativeToWT, heatmapHideFiltered, heatmapColorPalette, heatmapDivergentColorPalette = 'viola',
            heatmapDataObject, onDataLoad, structureKey, structureKeys, lcColumn, hcColumn, 
            structureColorScheme, structureColoringMetric, analysisImageFields = [], analysisImageNames = [],
            columnFilter, tableFormats = {}, matrixDataObject, seqColumns, seqColumnNames, columnDisplayNames={},
            stagedMutations, isVariantSelectionActive, acceptedVariants, visibleStructures,
            fontSize=12, msaTableColumns=['Names'], isRestraintUIActive
        } = this.props;

        const selection = this.getSelectionIndices(this.props.selection, columnarData._gyde_rowid);
        const filter = this.getFilterIndices(this.props.filter, columnarData._gyde_rowid);
        const explicitReference = this.getExplicitReference(this.props.explicitReference, columnarData._gyde_rowid);

        const heatmapDataScale = this.getHeatmapDataScale(this.props);
        const heatmapDataScales = this.getHeatmapDataScales(this.props);

        const columnTypes = this.getColumnTypes(columnarData, this.props.dataColumns, this.props.structureKeys, this.props.columnTypes, this.props.seqColumns);

        const alignments = this.getAlignments(),
            references = this.getReferences(),
            alternatives = this.getAlternatives();
        const seqData = this.getSequenceData(this.props);
        const refSeqData = this.getRefSequenceData(this.props);

        const {viewColumnarData, dataRows} = this.getViewData();
        const filteredItems = this.applyTableFilters(viewColumnarData, dataRows, tableFilters || {}, filter);

        const alignmentFeatures = this.mapFeatureSets(alignmentKey, alignments, seqColumns, this.props.cdrPos, this.props.vernierPos, this.getAbNumAlignments());

        const soloSelection  = selection && selection.size === 1 ? Array.from(selection)[0] : undefined;
        const soloSelectionData = (column) => columnarData[column] && soloSelection !== undefined ? columnarData[column][soloSelection] : undefined;

        const mdStatusList = Object.values(this.props.mdStatus || {}),
            mdRunning = mdStatusList.filter((s) => s === 'running').length,
            mdErrs = mdStatusList.filter((s) => s === 'error').length;

        const tapStatusList = Object.values(this.props.tapStatus || {}),
            tapRunning = tapStatusList.filter((s) => s === 'running').length,
            tapErrs = tapStatusList.filter((s) => s === 'error').length;

        // colourScheme.colours can be a string, object, or empty object
        // TODO: wrap this in a consistent data type
        const colourScheme = MSA_COLORS.filter((c) => c.name === colourSchemeKey)[0] || MSA_COLORS[0];

        const visibleColumns = this.getVisibleColumns(),
            columns = this.dataTableColumns(visibleColumns, columnDefs, columnDisplayNames);

        const typeface = MSA_TYPEFACES.filter((t) => t.name === typefaceName)[0] ||
                        MSA_TYPEFACES.filter((t) => t.isDefault)[0] || {};

        const hasStructAnalysisSection = !!analysisImageFields.some((f) => columnarData[f]);

        const layoutDict = this.getLayoutDict();

        const selectedSeqColumns = this.props.selectedSeqColumns || seqColumns.map(({column}) => column);

        const cellWidth = fontSize || 12,
              cellHeight = ((20 * cellWidth)/12)|0,
              cellPadding = cellWidth < 12 ? 1 : cellWidth < 20 ? 2 : 3;

        const heatmapNavBar = (
            <HeatmapNavBar
                dataScale={heatmapDataScale}
                dataScales={heatmapDataScales}
                setDataScale={(val) => this.setState({heatmapDataScale: val})}
                heatmapRelativeToWT={heatmapRelativeToWT}
                toggleHeatmapRelativeToWT={() => this.setState((oldState) => ({heatmapRelativeToWT: !oldState.heatmapRelativeToWT}))}
                heatmapHideFiltered={heatmapHideFiltered}
                toggleHeatmapHideFiltered={() => this.setState((oldState) => ({heatmapHideFiltered: !oldState.heatmapHideFiltered}))}
                colorPalette={heatmapColorPalette}
                setColorPalette={(val) => this.setState({heatmapColorPalette: val})}
                divergentColorPalette={heatmapDivergentColorPalette}
                setDivergentColorPalette={(val) => this.setState({heatmapDivergentColorPalette: val})}
                selectedColumn={heatmapSelectedColumn}
                setSelectedColumn={(val) => this.setState({heatmapSelectedColumn: val})}
                columns={columns}
                compact={(layoutDict['Structure'].isHalfWidth)}
                columnDisplayNames={columnDisplayNames}
            />
        )

        const variantSelectionComponent = (
            <VariantSelection
                isActive={this.props.isVariantSelectionActive}
                toggleIsActive={
                    () => this.setState({
                        isVariantSelectionActive: !this.props.isVariantSelectionActive,
                        stagedMutations: []
                    })
                }
                stagedMutations={stagedMutations}
                setStagedMutations={(val) => this.setState({stagedMutations: val})}
                acceptedVariants={this.props.acceptedVariants}
                setAcceptedVariants={(val) => this.setState({acceptedVariants: val})}
                nameColumn={this.props.nameColumn}
                refNameColumn={this.props.refNameColumn}
                
            />
        )

        const MSAWidget = (
            <Paper elevation={6} sx={{padding: '1rem'}} ref={this.sequenceTableRef}>
                <WidgetBoundaryWrapper>
                    <div style={{overflow:'auto'}}>
                        <NavBar
                            alignByMenuOnChange={
                                (ev) => {
                                    const transition = {
                                        alignmentKey: ev.target.attributes.value.value,
                                        selectedColumns: undefined
                                    }
                                    if (ev.target.attributes.value.value === 'alignedSeqs') {
                                        // Allow re-running of MSA
                                        transition.error = null;
                                    }
                                    this.setState(transition)   
                                }
                            }
                            targetSequenceMenuOnChange={
                                (ev) => this.setState(
                                    {
                                        alignmentTarget: ev,
                                        explicitReference: undefined,
                                        selectedColumns: undefined
                                    }
                                )
                            }

                            specialAlign={specialAlign}
                            alignmentKey={alignmentKey}
                            alignmentTarget={alignmentTarget}
                            alignmentError={abNumError ?? error}
                            wasHumanized={wasHumanized}
                            isAntibody={isAntibody}
                            referenceOptions={this.referenceOptions(alignmentTargets, hasSeeds, isAntibody)}

                            isSequenceLogoVisible={isSequenceLogoVisible}
                            toggleSequenceLogoVisibility={
                                () => this.setState((oldState) => ({isSequenceLogoVisible: !oldState.isSequenceLogoVisible}))
                            }

                            matrixDataObject={matrixDataObject}
                            isHeatmapVisible={isHeatmapVisible}
                            setHeatmapVisibility={(val) => this.setState({isHeatmapVisible: val})}
                            heatmapSelectedColumn={heatmapSelectedColumn}
                            setHeatmapSelectedColumn={(val) => this.setState({heatmapSelectedColumn: val})}

                            tap={(this.props.isAntibody && selection?.size > 0) ? this.runTAP : null}
                            moldesk={(this.props.isAntibody && selection?.size > 0) ? this.runMolDesk : null}
                            humanize={selection?.size === 1 && 
                                        alignmentKey === 'anarciSeqs' && 
                                        alignmentTarget !== '+seed' ?
                                        this.humanizeAction : null}
                            mpnn={() => this.setState({showingMPNN: true})}
                            ligandMPNN={() => this.setState({showingLigandMPNN: true})}
                            structureKeys={this.props.structureKeys}
                            columnarData={columnarData}
                            seqColumnData={seqData}
                            soloSelection={soloSelection}
                            onDataLoad={(data, props) => onDataLoad(data, {name: props.name || 'New dataset', icon: 'design', ...props}) }
                            addDataByIndex={this.addDataByIndex.bind(this)}
                            addDataByIndices={this.addDataByIndices.bind(this)}
                            
                            msaColors={MSA_COLORS}
                            colourScheme={colourScheme.name}
                            highlightCDRs={highlightCDRs}
                            colourBackground={colourBackground}
                            setColorScheme={(ev) => {
                                if (ev.target.attributes.value.value === '__hcdr') {
                                    this.setState((s) => ({
                                        highlightCDRs: !s.highlightCDRs,
                                        colourBackground: false
                                    }));
                                } else if (ev.target.attributes.value.value === '__colour_background') {
                                     this.setState((s) => ({
                                        highlightCDRs: false,
                                        colourBackground: !s.colourBackground
                                    }));
                                } else {
                                    this.setState({colourSchemeKey: ev.target.attributes.value.value});
                                }
                            }}

                            msaTypefaces={MSA_TYPEFACES}
                            typefaceName={typeface.name}
                            setTypefaceName={(n) => this.setState({typefaceName: n})}
                            fontSize={fontSize}
                            setFontSize={(s) => this.setState({fontSize: s})}

                            columns={ columns }
                            seqColumns={ seqColumns }
                            seqColumnNames={ seqColumnNames }
                            hcColumn={ this.props.hcColumn }
                            lcColumn={ this.props.lcColumn }
                            selectedSeqColumns={ selectedSeqColumns }
                            selected={ msaTableColumns }
                            toggle={ this.toggleMSADataField }

                            selection={selection}
                            showExportOptions={this.showExportOptions}
                            doFilter={this.doFilter}
                            doUnfilter={this.doUnfilter}
                            filter={filter}
                            tableFilters={tableFilters}
                            doSelectAll={this.doSelectAll}
                            doSelectNone={this.doSelectNone}
                            doInvertSelection={this.doInvertSelection}
                            doInvertSelectedColumns={this.doInvertSelectedColumns}
                            isDNA={this.props.isDNA}
                            compact={layoutDict['Sequences'].isHalfWidth}
                            columnDisplayNames={columnDisplayNames}

                            selectedColumns={this.props.selectedColumns}
                            columnFilter={this.props.columnFilter}
                            doColumnFilter={this.doColumnFilter}
                            doColumnUnfilter={this.doColumnUnfilter}
                            doColumnFilterByHeatmap={this.doColumnFilterByHeatmap}
                            doColumnFilterByNonGap={this.doColumnFilterByNonGap}

                            doAddColumn={this.doAddColumn}
                            showMerge={this.showMerge}
                            showSelectByIndex={this.showSelectByIndex}
                            createRestraintFromSelection={this.createRestraintFromSelection}

                            explicitReference={explicitReference}
                            setExplicitReference={this.setExplicitReference}
                            setSuppressDatasetReference={this.setSuppressDatasetReference}
                            suppressDatasetReference={this.props.suppressDatasetReference}
                            hasDatasetReference={(this.props.seqRefColumns || []).map((c) => (c && c.column) ? columnarData[c.column] : undefined).filter((x) => x).length > 0}
                            seqNames={viewColumnarData['Names'] || []}
                            primaryNavBarExtrasRef={this.primaryNavBarExtrasRef}

                            alignmentStatus={{
                                mafft: !error && this.props.mafftPending,
                                abNum: !abNumError && (this.props.isAntibody && !this.props.abNumColumns)
                            }}
                        />
                        { (isHeatmapVisible) ?
                            <HeatmapNavBar
                                dataScale={heatmapDataScale}
                                dataScales={heatmapDataScales}
                                setDataScale={
                                    (value) => this.setState({heatmapDataScale: value})
                                }
                                heatmapRelativeToWT={heatmapRelativeToWT}
                                toggleHeatmapRelativeToWT={
                                    () => this.setState((oldState) => ({heatmapRelativeToWT: !oldState.heatmapRelativeToWT}))
                                }
                                heatmapHideFiltered={heatmapHideFiltered}
                                toggleHeatmapHideFiltered={
                                    () => this.setState((oldState) => ({heatmapHideFiltered: !oldState.heatmapHideFiltered}))
                                }
                                colorPalette={heatmapColorPalette}
                                setColorPalette={
                                    (value) => this.setState({heatmapColorPalette: value})
                                }
                                divergentColorPalette={heatmapDivergentColorPalette}
                                setDivergentColorPalette={
                                    (val) => this.setState({heatmapDivergentColorPalette: val})
                                }
                                selectedColumn={heatmapSelectedColumn}
                                setSelectedColumn={
                                    (val) => this.setState({heatmapSelectedColumn: val})
                                }

                                matrixDataObject={matrixDataObject}
                                columns={columns}
                                columnDisplayNames={columnDisplayNames}
                                compact={layoutDict['Sequences'].isHalfWidth}
                                heatmapData={heatmapDataObject}
                                alignments={alignments}
                                seqColumns={seqColumns}
                                seqColumnNames={seqColumnNames}
                                variantSelectionComponent={variantSelectionComponent}
                            />
                            : null
                        }
                        <SequenceTable 
                            alignments={ alignments }
                            alignmentFeatures={ alignmentFeatures }
                            seqColumns={ seqColumns }
                            seqColumnNames={seqColumnNames }
                            dataColumns={ msaTableColumns }
                            reorderDataColumns={ this.reorderMSADataFields }
                            hcColumn={ this.props.hcColumn }
                            lcColumn={ this.props.lcColumn }
                            references={ references }
                            alternatives={ alternatives }
                            columnarData={ viewColumnarData }
                            dataRows={ dataRows }
                            selectionIds={ selection }
                            updateSelection={ this.updateSelectionFromMSA }
                            colours={colourScheme.colours}
                            systemFont={typeface.systemFont}
                            systemFontScale={typeface.systemFontScale}
                            highlightCDRs={highlightCDRs}
                            colourBackground={colourBackground}
                            sortField={ this.props.sortField }
                            updateSortField={ this.updateSortField }
                            toggleSequenceAlternate={ this.toggleAlternateAction }
                            updateDatum={ this.updateDatum }
                            ref={ (table) => { this.sequenceTable = table } }
                            filter={ filter }
                            columnFilter={columnFilter}
                            doColumnUnfilterRange={ this.doColumnUnfilterRange }
                            updateSelectedColumns={ this.updateSelectedColumns} 
                            updateSelectedOtherColumns={ this.updateSelectedOtherColumns }
                            selectedColumns={ this.props.selectedColumns }
                            selectedOtherColumns={ this.props.selectedOtherColumns }
                            tableFilters={ tableFilters }
                            updateTableFilters={ this.updateTableFilters }
                            isSequenceLogoVisible={ isSequenceLogoVisible }
                            isHeatmapVisible={ isHeatmapVisible }
                            heatmapDataObject={heatmapDataObject}
                            heatmapDataScale={heatmapDataScale}
                            heatmapRelativeToWT={heatmapRelativeToWT}
                            heatmapColorPalette={(heatmapRelativeToWT) ? heatmapDivergentColorPalette : heatmapColorPalette}
                            matrixDataObject={matrixDataObject}
                            compact={layoutDict['Sequences'].isHalfWidth}
                            cellWidth={cellWidth}
                            cellHeight={cellHeight}
                            cellPaddingX={cellPadding}
                            cellPaddingY={cellPadding}
                            tableFormats={tableFormats}
                            updateTableFormats={this.updateTableFormats}
                            columnTypes={columnTypes}
                            columnDisplayNames={columnDisplayNames}
                            stagedMutations={stagedMutations}
                            setStagedMutations={
                                (val) => this.setState({stagedMutations: val})
                            }
                            isVariantSelectionActive={this.props.isVariantSelectionActive}
                            nameColumn={this.props.nameColumn}
                            refNameColumn={this.props.refNameColumn}
                            setViewingJob={this.setViewingJob}
                            cancelSlivkaJob={this.cancelSlivkaJob}
                            bottomNav={/*bottomNavBar */ undefined}
                        />
                        <SequenceTableExportControls 
                            show={this.props.showExportOptions}
                            onSubmit={this.doExport}
                            onHide={this.hideExportOptions}
                            hasColumnSelection={(this.props.selectedColumns||[]).some((sel) => (sel?.size||0) > 0 )}
                        />
                    </div>
                </WidgetBoundaryWrapper>
            </Paper>
        )

        const structureWidget = (
            <Paper
                elevation={6}
                sx={{padding: '1rem'}}
                ref={this.structureRef}
            >
                <WidgetBoundaryWrapper>
                    { /* minWidth needed here to make resize-sensor work properly */ }
                    <div style={{flex: '1', minWidth: '0px'}}>
                        <div style={{width: "100%", }}>
                            <StructureHolder
                                columnarData={ columnarData }
                                dataColumns={ this.props.dataColumns }
                                columnTypes={ columnTypes }
                                columnDisplayNames={ columnDisplayNames }
                                selection={ selection }
                                updateSelection={this.updateSelection.bind(this)}
                                addValueToNewStructureColumn={this.addValueToNewStructureColumn}
                                updateDatum={this.updateDatum}
                                isAntibody={ isAntibody }
                                structureKeys={ structureKeys }
                                structureKey={ structureKey }
                                visibleStructures={ visibleStructures }
                                setVisibleStructures={ (val) => this.setState({visibleStructures: val}) }
                                structureSequence={ this.props.structureSequence || 'selected' }
                                setStructureSequence={ (val) => this.setState({structureSequence: val}) }
                                seqColumns={ seqData }
                                seqRefColumns={ refSeqData }
                                alignmentFeatures= { alignmentFeatures }
                                alignments={ alignments }
                                references={ references } 
                                alignmentKey={ alignmentKey }
                                hcColumn={ hcColumn }
                                lcColumn={ lcColumn }
                                soloSelection={soloSelection}
                                restraints={ this.props.restraints }

                                structureColorScheme={structureColorScheme}
                                setStructureColorScheme={
                                    (val) => this.setState({structureColorScheme: val})
                                }
                                heatmapData={heatmapDataObject}
                                colormap={(heatmapRelativeToWT) ? heatmapDivergentColorPalette : heatmapColorPalette}
                                heatmapColumn={heatmapSelectedColumn}
                                isHeatmapVisible={ isHeatmapVisible }
                                structureColoringMetric={structureColoringMetric}
                                setStructureColoringMetric={
                                    (val) => this.setState({structureColoringMetric: val})
                                }
                                heatmapNavBar={heatmapNavBar}

                                selectedColumns={this.props.selectedColumns}
                                updateSelectedColumns={this.updateSelectedColumns}
                                autoSuperpose={this.props.autoSuperpose ?? true}
                                setAutoSuperpose={this.setAutoSuperpose}

                                nameColumn={this.props.nameColumn}
                                refNameColumn={this.props.refNameColumn}

                                compact={layoutDict['Structure'].isHalfWidth}

                                sequenceCompact={layoutDict['Sequences'].isHalfWidth /* This is rather nasty, but needed because we are relocating the "Structure Prediction" button to the sequence navbar */}
                                primaryNavBarExtras={this.primaryNavBarExtrasRef}
                                setViewingJob={this.setViewingJob}
                            />
                        </div>
                    </div>
                </WidgetBoundaryWrapper>
            </Paper>
        )

        const structAnalysisWidget = (
            hasStructAnalysisSection ?
                <Paper elevation={6} sx={{padding: '1rem'}} ref={this.structAnalysisRef}>
                    <WidgetBoundaryWrapper>
                        <Grid container>
                            { analysisImageFields.flatMap((field, aifIndex) => {
                                const url = soloSelectionData(field);
                                if (!url || url.startsWith('file:')) return [];

                                const title = analysisImageNames[aifIndex];

                                return ([
                                    <Grid key={aifIndex} item xs={12}>
                                        { title ? <h4>{title}</h4> : undefined }
                                        <img src={url} alt='' style={{maxWidth: '90vw'}}/>
                                    </Grid>
                                ])
                            }) }
                        </Grid>
                    </WidgetBoundaryWrapper>
                </Paper>
            : null
        )

        const plotWidget = (
            <Paper elevation={6} sx={{padding: '1rem'}} ref={this.plotRef}>
                <WidgetBoundaryWrapper>
                    <ButtonGroup variant="outlined"
                                    disableElevation>
                        <Button variant={this.props.plotControlMode === "select" ? "contained" : undefined}
                                onClick={(ev) => this.setState({plotControlMode: 'select'})}>
                            <Tooltip title="Rectangular selection">
                                <SelectIcon />
                            </Tooltip>
                        </Button>
                        <Button variant={this.props.plotControlMode === "lasso" ? "contained" : undefined}
                                onClick={(ev) => this.setState({plotControlMode: 'lasso'})}>
                            <Tooltip title="Freehand selection">
                                <LassoIcon />
                            </Tooltip>
                        </Button>
                        <Button variant={this.props.plotControlMode === "zoom" ? "contained" : undefined}
                                onClick={(ev) => this.setState({plotControlMode: 'zoom'})}>
                            <Tooltip title="Zoom mode (drag to zoom in, single click to reset)">
                                <ZoomIcon />
                            </Tooltip>
                        </Button>
                        <Button />
                        <PlotControlMenu 
                            plotRows={plotRows}
                            plotCols={plotCols}
                            setState={this.setState}
                        />
                    </ButtonGroup>

                    <div style={{width: '100%', display: 'grid', gridTemplateColumns: '1fr '.repeat(plotCols)}}>
                        { plots.map((plot, index) => (
                            <PlotCombo 
                                key={index}
                                controllerStyle={{
                                    gridRow: (((index/plotCols)|0)*2)+1,
                                    gridColumn: 1+(index%plotCols)
                                }}
                                plotStyle={{
                                    gridRow: (((index/plotCols)|0)*2 + 2),
                                    gridColumn: 1+(index%plotCols),
                                    minWidth: 0
                                }}
                                {...plot}

                                plotHeight={ (plotCols === 1 && !layoutDict['Plot'].isHalfWidth) ? 500 : 200 }
                                dataRows={ dataRows }
                                columnarData={ viewColumnarData }
                                seqIds={ viewColumnarData['Names'] || [] }
                                dataColumns={ visibleColumns }
                                selection={ selection }
                                onSelect={ s => this.updateSelection(s) }
                                dynamicWidth
                                updateProps={this.plotSetter(index)}
                                filteredItems={filteredItems}
                                filter={filter}
                                plotControlMode={this.props.plotControlMode} 
                                columnTypes={columnTypes}
                                columnDisplayNames={columnDisplayNames}

                                nameColumn={this.props.nameColumn}
                                refNameColumn={this.props.refNameColumn}
                            />
                        )) }
                    </div>
                </WidgetBoundaryWrapper>
            </Paper>
        )

        const TAPWidget = (
            isAntibody ?
                <Paper elevation={6} sx={{padding: '1rem'}} ref={this.TAPRef}>
                    <WidgetBoundaryWrapper>
                        <Grid container>
                            { /* If we switch to MUIv5, we can do this using something like
                                    <Grid item xs={12} container columns={5}>...</Grid>
                                    but this is not available in MUIv4, so fall back to "normal"
                                flexbox */ }

                            { soloSelection !== undefined
                                ? (soloSelectionData('graph_cdrlen') || soloSelectionData('graph_ppc') || soloSelectionData('graph_pnc') || soloSelectionData('graph_psh') || soloSelectionData('graph_sfvcsp'))
                                ? <Grid item xs={12} style={{display: 'flex'}}>
                                    <div style={{flex: '1', minWidth: '0px', overflow: 'hidden'}}>
                                        <h4 style={{whiteSpace: 'nowrap'}}>CDR Length</h4>
                                        <TAPPlot data={soloSelectionData('graph_cdrlen')}
                                                dynamicWidth />
                                    </div>
                                    <div style={{flex: '1', minWidth: '0px'}}>
                                        <h4 style={{whiteSpace: 'nowrap'}}>Patch +ve charge</h4>
                                        <TAPPlot data={soloSelectionData('graph_ppc')}
                                                dynamicWidth />
                                    </div>
                                    <div style={{flex: '1', minWidth: '0px', overflow: 'hidden'}}>
                                        <h4 style={{whiteSpace: 'nowrap'}}>Patch -ve charge</h4>
                                        <TAPPlot data={soloSelectionData('graph_pnc')}
                                                dynamicWidth />
                                    </div>
                                    <div style={{flex: '1', minWidth: '0px', overflow: 'hidden'}}>
                                        <h4 style={{whiteSpace: 'nowrap'}}>Patch surface hydrophobicity</h4>
                                        <TAPPlot data={soloSelectionData('graph_psh')}
                                                dynamicWidth />
                                    </div>
                                    <div style={{flex: '1', minWidth: '0px', overflow: 'hidden'}}>
                                    <Tooltip title="Fv surface charge assymetry">
                                        <h4 style={{whiteSpace: 'nowrap'}}>SFvCSP</h4>
                                    </Tooltip>
                                        <TAPPlot data={soloSelectionData('graph_sfvcsp')}
                                            dynamicWidth />
                                    </div>
                                    </Grid>
                                : <Grid item xs={12}>
                                    Therapeutic Antibody Profiler (TAP) plots appear here
                                    </Grid>
                                : <Grid item xs={12}>
                                    {/* Select a single antibody to see TAP results */}
                                </Grid>
                        }
                                <Grid item xs={6}>
                                    {(mdRunning !== 0) && <div>Running MolDesk on { mdRunning } antibodies <CircularProgress /></div> }
                                    {(mdErrs !== 0) && <div style={{color: 'red'}}>MolDesk failed on { mdErrs } antibodies</div> }
                                </Grid>

                                <Grid item xs={6}>
                                    {(tapRunning !== 0) && <div>Running TAP on { tapRunning } antibodies <CircularProgress /></div>  }
                                    {(tapErrs !== 0) && <div style={{color: 'red'}}>TAP failed on { tapErrs } antibodies</div> }
                                </Grid>
                            </Grid>
                    </WidgetBoundaryWrapper>
                </Paper>
                : null
        )

        const dataWidget = (
            <Paper elevation={6} sx={{padding: '1rem'}} ref={this.dataRef}>
                <WidgetBoundaryWrapper>
                    <RenameColumn seqColumns={this.props.seqColumns} columns={this.props.dataColumns.filter(column=>!column.startsWith('_gyde_'))} labels={columnDisplayNames}
                        onRename={(column,name)=>this.setState(old=>({columnDisplayNames:{...old.columnDisplayNames,[column]:name}}))}/>
                    <NavBar
                        showTableMenuOnly
                        columns={ columns }
                        selected={ dataFields }
                        toggle={ this.toggleDataField }

                        selection={selection}
                        showExportOptions={this.showDataExportOptions}
                        doFilter={this.doFilter}
                        doUnfilter={this.doUnfilter}
                        filter={filter}
                        tableFilters={tableFilters}
                        isDNA={this.props.isDNA}

                        doAddColumn={this.doAddColumn}
                    />
                    <SequenceTableExportControls 
                        show={this.props.showDataExportOptions}
                        onSubmit={this.doDataExport}                                                     
                        onHide={this.hideDataExportOptions}
                    />
                    <SequenceTable
                        noSequences
                        columnarData={ viewColumnarData }
                        dataRows={ dataRows }
                        dataColumns={ this.props.dataFields }
                        reorderDataColumns={ this.reorderDataFields }
                        selectionIds={ selection }
                        updateSelection={ this.updateSelectionFromMSA }
                        colours={colourScheme.colours}
                        systemFont={typeface.systemFont}
                        systemFontScale={typeface.systemFontScale}
                        sortField={ this.props.sortField }
                        updateSortField={ this.updateSortField }
                        updateDatum={ this.updateDatum }
                        filter={ filter }
                        tableFilters={ tableFilters }
                        updateTableFilters={ this.updateTableFilters }
                        tableFormats={tableFormats}
                        updateTableFormats={this.updateTableFormats}
                        columnTypes={columnTypes}
                        columnDisplayNames={columnDisplayNames}
                        nameColumn={this.props.nameColumn}
                        refNameColumn={this.props.refNameColumn}
                        setViewingJob={this.setViewingJob}
                        cancelSlivkaJob={this.cancelSlivkaJob}
                    />
                </WidgetBoundaryWrapper>
            </Paper>
        )

        const frequencyAnalysisWidget = (this.props.allowFrequencyAnalysis ?
            <Paper elevation={6} sx={{padding: '1rem'}} ref={this.frequencyAnalysisRef}>
                <WidgetBoundaryWrapper>
                    <FrequencyAnalysis
                        names={ viewColumnarData['Names'] }
                        data={ viewColumnarData }
                        alignments={ alignments }
                        references={ references }
                        filter={ filteredItems }
                        setRowSelection={(sel) => {
                            const rowids = this.props.columnarData._gyde_rowid;
                            this.setState({selection: new Set(Array.from(sel).map((i) => rowids[i]))});
                        }}
                        soloSelection={ soloSelection }
                        seqColumns={ seqData }
                        selectedColumns={this.props.selectedColumns}
                        updateSelectedColumns={this.updateSelectedColumns}
                        colours={colourScheme.colours}
                        compact={layoutDict['Frequency Analysis'].isHalfWidth}
                        nameColumn={this.props.nameColumn}
                        refNameColumn={this.props.refNameColumn}
                    />
                </WidgetBoundaryWrapper>
            </Paper>
            : null
        )

        const shoppingCartWidget = (
            (isVariantSelectionActive || acceptedVariants.length > 0)
              ? <Paper elevation={6} sx={{padding: '1rem'}} ref={this.shoppingCartRef}>
                    <WidgetBoundaryWrapper>
                        <ShoppingCart
                            acceptedVariants={ acceptedVariants }
                            setAcceptedVariants={(val) => this.setState({acceptedVariants: val})}
                            seqColumns={ seqColumns }
                            seqColumnNames={ seqColumnNames }
                            columnarData={ columnarData }
                            alignments={ alignments }
                            isDNA={ this.props.isDNA }
                            nameColumn={ this.props.nameColumn }
                            refNameColumn={this.props.refNameColumn}
                        />
                    </WidgetBoundaryWrapper>
                </Paper>
              : null
        );

        const restraintWidget = (
            isRestraintUIActive
              ? <Paper elevation={6} sx={{padding: '1rem'}} ref={this.restraintRef}>
                    <WidgetBoundaryWrapper>
                        <Restraints restraints={this.props.restraints} 
                                    seqColumns={this.props.seqColumns}
                                    seqColumnNames={this.props.seqColumnNames}
                                    updateRestraint={this.updateRestraint}
                                    deleteRestraint={this.deleteRestraint} />
                    </WidgetBoundaryWrapper>
                </Paper>
              : null
        );

        return {
            'Sequences': MSAWidget,
            'Structure': structureWidget,
            'Struct. Analysis': structAnalysisWidget,
            'Plot': plotWidget,
            'TAP': TAPWidget,
            'Data': dataWidget,
            'Frequency Analysis': frequencyAnalysisWidget,
            'Shopping Cart': shoppingCartWidget,
            'Restraints': restraintWidget
        };
    }

    _doUpdateLayout(oldState, dragEntry, hoverIndex, where) {
        const {columnarData, analysisImageFields=[]} = oldState;
        const hasStructAnalysisSection = !!analysisImageFields.some((f) => columnarData[f]);

        const sectionVisible = {
            'Sequences': true,
            'Structure': true,
            'Data': true,
            'Struct. Analysis': hasStructAnalysisSection,
            'TAP': oldState.isAntibody,
            'Plot': true,
            'Frequency Analysis': true,
            'Shopping Cart': oldState.isVariantSelectionActive || oldState.acceptedVariants.length > 0,
            'Restraints': oldState.isRestraintUIActive
        };

        const freshLayout = oldState.layout.map(l => ({...l}));
        const updatedLayout = [...freshLayout.filter((l) => sectionVisible[l.name]), ...freshLayout.filter((l) => !sectionVisible[l.name]).map((l) => ({...l, isHalfWidth: false}))]
        updatedLayout.forEach((item, index) => updatedLayout[index].index = index);
        
        const rows = [];
        {
            let fitSibling = false;
            for (const l of updatedLayout) {
                if (!sectionVisible[l.name]) continue;

                if (l.isHalfWidth && fitSibling) {
                    rows[rows.length - 1].push(l);
                    fitSibling = false;
                } else {
                    rows.push([l]);
                    fitSibling = l.isHalfWidth;
                }
            }
        }
        for (const r of rows) {
            if (r.length === 1) r.forEach((l) => l.isHalfWidth = false);
        }

        if (dragEntry) {
            const dragIndex = updatedLayout.filter(l => l.name === dragEntry)[0].index;
            const sourceRow = rows.findIndex((r) => r.some((l) => l.name === updatedLayout[dragIndex].name));
            rows[sourceRow].forEach((l) => l.isHalfWidth = false);

            if (where === 'left' || where === 'right') {
                let destIndex = rows[hoverIndex][0].index;
                if (where === 'right') ++destIndex;

                if ((rows[hoverIndex].length > 1) ^ (sourceRow === hoverIndex)) return null;

                rows[hoverIndex][0].isHalfWidth = true;
                if (sourceRow === hoverIndex) rows[hoverIndex].forEach((x) => {x.isHalfWidth = true});

                if (destIndex > dragIndex && sourceRow !== hoverIndex) destIndex -= 1;

                const [move] = updatedLayout.splice(dragIndex, 1);
                move.isHalfWidth = true;
                updatedLayout.splice(destIndex, 0, move);
            } else {
                let destIndex = rows[hoverIndex] ? rows[hoverIndex][0].index : updatedLayout.length - 1;
                if (destIndex > dragIndex) destIndex -= 1;
                const [move] = updatedLayout.splice(dragIndex, 1);
                updatedLayout.splice(destIndex, 0, move);
            }

            // update stored indices
            updatedLayout.forEach((item, index) => updatedLayout[index].index = index);
        }

        return {layout: updatedLayout};
    }

    updateLayout(dragEntry, hoverIndex, where) {
        this.setState((oldState) => this._doUpdateLayout(oldState, dragEntry, hoverIndex, where));
    };

    checkUpdateLayout(dragEntry, hoverIndex, where) {
        if (!dragEntry) return;
        return !!this._doUpdateLayout(this.props, dragEntry, hoverIndex, where);
    }

    _getLayoutDict = memoize((layout) => {
        return layout.reduce((prev, curr) => {
            return {...prev, [curr.name]: {...curr}};
        }, {});
    })

    getLayoutDict() {
        return this._getLayoutDict(this.props.layout);
    }

    updateSelection(sel) {
        const selSet = sel && sel.length > 0 ? new Set(sel) : null;
        const rowids = this.props.columnarData._gyde_rowid;
        this.setState({
            selection: selSet ? new Set(Array.from(selSet).map((i) => rowids[i])) : undefined,
        })
    }

    updateSelectionFromMSA({op, item, swizzle, scrollIntoView}) {
        this.setState((oldState) => {
            const rowids = oldState.columnarData._gyde_rowid;
            if (op === 'set') {
                let selection, lastSelectedRow;

                if (item instanceof Array || item instanceof Set) {
                    selection = new Set(item);
                    lastSelectedRow = undefined;
                } else if (item < 0) {
                    selection = null;
                    lastSelectedRow = undefined;
                } else {
                    selection = new Set([item]);
                    lastSelectedRow = item
                }

                if (scrollIntoView && selection) {
                    const selectArray = Array.from(selection);
                    selectArray.sort((a, b) => a-b);
                    if (selectArray.length > 0 && this.sequenceTable) {
                        const scrollRow = selectArray[0];
                        this.sequenceTable.scrollIntoView(scrollRow);
                    }
                }

                return {
                    selection: selection ? new Set(Array.from(selection).map((i) => rowids[i])) : undefined, 
                    lastSelectedRow
                };
            } else if (op === 'extend' && typeof(oldState.lastSelectedRow) === 'number') {
                if (item < 0) return {};

                if (swizzle) {
                    const itemIndex = swizzle.indexOf(item),
                          lsrIndex = swizzle.indexOf(oldState.lastSelectedRow);

                    if (itemIndex < 0 || lsrIndex < 0) return {};

                    const newSel = new Set(oldState.selection || []),
                          rangeMin = Math.min(itemIndex, lsrIndex),
                          rangeMax = Math.max(itemIndex, lsrIndex);
                    for (let i = rangeMin; i <= rangeMax; ++i) newSel.add(rowids[swizzle[i]]);

                    return {
                        selection: newSel,
                        lastSelectedRow: item
                    }

                } else {
                    const newSel = new Set(oldState.selection || []),
                          rangeMin = Math.min(item, oldState.lastSelectedRow),
                          rangeMax = Math.max(item, oldState.lastSelectedRow);
                    for (let i = rangeMin; i <= rangeMax; ++i) newSel.add(rowids[i]);

                    return {
                        selection: newSel,
                        lastSelectedRow: item
                    }
                }
            } else {
                if (item < 0) return {};
                
                const newSel = new Set(oldState.selection || []);
                if (newSel.has(rowids[item])) {
                    newSel.delete(rowids[item]);
                } else {
                    newSel.add(rowids[item]);
                }

                if (newSel.size > 0) {
                    return {
                        selection: newSel,
                        lastSelectedRow: item
                    };
                } else {
                    return {
                        selection: null,
                        lastSelectedRow: item
                    };
                }
            }
        })
    }

    doInvertSelectedColumns() {
        this.setState((oldState) => {
            const alignments = this.getAlignmentsData(oldState);
            const oldSelectedColumns = oldState.selectedColumns || [];

            const selectedColumns = alignments.map((ali, i) => {
                const oldSel = oldSelectedColumns[i] || new Set();
                const length = (ali.data || []).reduce((a, b) => Math.max(a, b.length), 0);
                const selection = new Set();
                for (let i = 0; i < length; ++i) {
                    if (!oldSel.has(i)) selection.add(i);
                }
                return selection;
            });

            return {
                selectedColumns,
                lastSelectedColumn: undefined
            }
        });
    }

    updateSelectedColumns(seqColumn, {op, column, swizzle}) {
        this.setState((oldState) => {
            const seqColumnIndex = oldState.seqColumns.findIndex(({column}) => column === seqColumn);
            if (seqColumnIndex < 0) return null;

            const newSelectedColumns = [...oldState.selectedColumns || []],
                  newLastSelectedColumn = [...oldState.lastSelectedColumn || []],
                  lastSelectedColumn = newLastSelectedColumn[seqColumnIndex];

            if (op === 'set') {
                if (column instanceof Array || column instanceof Set) {
                    newSelectedColumns[seqColumnIndex] = new Set(column);
                } else if (column < 0) {
                    newSelectedColumns[seqColumnIndex] = undefined;
                    newLastSelectedColumn[seqColumnIndex] = undefined;
                } else {
                    newSelectedColumns[seqColumnIndex] = new Set([column]);
                    newLastSelectedColumn[seqColumnIndex] = column;
                }
            } else if (op === 'extend' && typeof(lastSelectedColumn) === 'number') {
                if (column < 0) return {};

                if (swizzle) {
                    const columnIndex = swizzle.indexOf(column),
                          lastIndex = swizzle.indexOf(lastSelectedColumn);

                    if (columnIndex < 0 || lastIndex < 0) return {};

                    const newSel = new Set(newSelectedColumns[seqColumnIndex] || []),
                          rangeMin = Math.min(columnIndex, lastIndex),
                          rangeMax = Math.max(columnIndex, lastIndex);
                    for (let i = rangeMin; i <= rangeMax; ++i) newSel.add(swizzle[i]);
                    newSelectedColumns[seqColumnIndex] = newSel;
                    newLastSelectedColumn[seqColumnIndex] = column;
                } else {
                    const newSel = new Set(newSelectedColumns[seqColumnIndex] || []),
                          rangeMin = Math.min(column, lastSelectedColumn),
                          rangeMax = Math.max(column, lastSelectedColumn);
                    for (let i = rangeMin; i <= rangeMax; ++i) newSel.add(i);
                    newSelectedColumns[seqColumnIndex] = newSel;
                    newLastSelectedColumn[seqColumnIndex] = column;
                }
            } else {
                if (column < 0) return {};

                const newSel = new Set(newSelectedColumns[seqColumnIndex] || []);
                if (newSel.has(column)) {
                    newSel.delete(column);
                } else {
                    newSel.add(column);
                }

                if (newSel.size > 0) {
                    newSelectedColumns[seqColumnIndex] = newSel;
                } else {
                    newSelectedColumns[seqColumnIndex] = undefined;
                }
                newLastSelectedColumn[seqColumnIndex] = column;
            }

            return {
                selectedColumns: newSelectedColumns,
                lastSelectedColumn: newLastSelectedColumn
            };
        });
    }

    updateSelectedOtherColumns(column) {
        this.setState((oldState) => {
            const soc = {...(oldState.selectedOtherColumns || {})};
            if (soc[column]) {
                delete soc[column];
            } else {
                soc[column] = true;
            }

            return {selectedOtherColumns: soc};
        });
    }

    mapFeatureSets = memoize((alignmentKey, alignments, seqColumns, cdrPos, vernierPos, abNumAlignment) => {
        if ((alignmentKey !== 'anarciSeqs' && !abNumAlignment) || alignmentKey === 'seqs') return seqColumns.map((_) => []);

        return (alignments || []).map((a, i) => {
            const seqName = seqColumns[i].column;
            if (seqName === this.props.hcColumn) return this.mapFeatures('H', a, cdrPos, vernierPos, alignmentKey !== 'anarciSeqs' ? abNumAlignment[i] : undefined);
            if (seqName === this.props.lcColumn) return this.mapFeatures('L', a, cdrPos, vernierPos, alignmentKey !== 'anarciSeqs' ? abNumAlignment[i] : undefined);
            return [];
        });
    });

    mapFeatures(chainName, alignedSeqs, cdrPos, vernierPos, abNumAlignedSeqs) {
        function cmp(p1, p2) {
            if (!p1 || !p2 || p1[0] !== p2[0]) return false;
            const i1 = parseInt(p1.substring(1)), i2 = parseInt(p2.substring(1));
            if (i1 > i2) {
                return true;
            } else if (i1 === i2) {
                return p1.localeCompare(p2) >= 0;
            }
        }

        const features = [];

        if (alignedSeqs && alignedSeqs.length > 0) {
            let residueNumbers = alignedSeqs.residueNumbers; 


            // If no residue numbers are available, attempt to map them across from the
            // anarci-aligned alternatives.
            if (abNumAlignedSeqs) {
                const anarciSeq = abNumAlignedSeqs[0];
                if (anarciSeq) {
                    const flatResidueNumbers = [];
                    for (let i = 0; i < anarciSeq.length; ++i) {
                        if (anarciSeq[i] !== '-') flatResidueNumbers.push(abNumAlignedSeqs.residueNumbers[i])
                    }

                    residueNumbers = [];
                    let cursor = 0;
                    for (let i = 0; i < alignedSeqs[0].length; ++i) {
                        residueNumbers.push(alignedSeqs[0][i] === '-' ? null : flatResidueNumbers[cursor++]);
                    }
                }
            }

            if (!residueNumbers) return [];
            residueNumbers = residueNumbers.map((r) => `${chainName}${r}`);

            if (residueNumbers) {
                for (const [name, {start, stop, color, label}] of Object.entries(cdrPos)) {
                    for (let i = 0; i < residueNumbers.length; ++i) {
                        if (cmp(residueNumbers[i], start)) {
                            for (let j = i + 1; j < residueNumbers.length; ++j) {
                                if (cmp(residueNumbers[j], stop)) {
                                    features.push({
                                        source: 'CDRs',
                                        feature: label === undefined ? name : label,
                                        text: label === undefined ? name : label,
                                        start: i + 1,
                                        end: j + 1,
                                        strand: '+',
                                        frame: 0,
                                        attributes: {},
                                        color
                                    })
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }

                for (const pos of vernierPos) {
                    for (let i = 0; i < residueNumbers.length; ++i) {
                        if (pos === residueNumbers[i]) {
                            features.push({
                                source: 'Vernier positions',
                                feature: '',
                                text: '',
                                start: i+1,
                                end: i+1,
                                strand: '+',
                                frame: 0,
                                attributes: {},
                                color: '#999999'
                            })
                        }
                    }
                }
            }
        }

        return features;
    }

    dataTableColumns = memoize((dataColumns, columnDefs, columnDisplayNames={}) => {
        const columnsByDesc = {};
        if (columnDefs) {
            for (const col of columnDefs) {
                columnsByDesc[col.descriptor] = col;
            }
        } 

        const columns = [];
        const addColumn = (head, hidden) => {
            const def = columnsByDesc[head] || {};

            if (head) {
                columns.push({
                    title: columnDisplayNames[head] || head,
                    field: head,
                    tooltip: def.definition
                });
            }
        }

        for (const col of columnDefs || []) {
            if (col.showByDefault) {
                if (dataColumns.indexOf(col.descriptor) >= 0) addColumn(col.descriptor, false);
            }
        }

        for (const col of dataColumns) {
            if (columns.some((c) => c.field === col)) continue;
           
            addColumn(col, true);
        }

        columns.sort((a, b) => (a.title || '').localeCompare((b.title || ''), 'en', {sensitivity: 'base'}));

        return columns;
    });

    addDataByIndex(update, index) {
        return this.addDataByIndices([update], [index]);
    }
    
    addDataByIndices(updates, indices) {
        this.setState((oldState) => {
            const newColumnarData = {...oldState.columnarData};
            const newDataColumns = [...oldState.dataColumns];
            const dataRowCount = oldState.dataRowCount;
    
            updates.forEach((update, i) => {
                for (const [field, val] of Object.entries(update)) {
                    if (field === 'index') continue;
        
                    if (field in newColumnarData) {
                        newColumnarData[field] = [...newColumnarData[field]];
                    } else {
                        newColumnarData[field] = new Array(dataRowCount);
                    }

                    if (newDataColumns.indexOf(field) < 0) newDataColumns.push(field);
                    newColumnarData[field][indices[i]] = val;
                }
            });

            return {
                columnarData: newColumnarData,
                dataColumns: newDataColumns,
            };
        })
    }

    addDataKV(updates) {
        if (! (updates instanceof Array)) updates = [updates];

        this.setState((oldState) => {

            const updatedColumns = new Set(['_gyde_rowid']);
            for (const u of updates) {
                for (const [k, _v] of Object.entries(u)) {
                    updatedColumns.add(k);
                }
            }

            const newColumnarData = {...oldState.columnarData};
            for (const c of updatedColumns) {
                newColumnarData[c] = [...newColumnarData[c] || []];
            }
            const newDataColumns = [...oldState.dataColumns];
            let dataRowCount = oldState.dataRowCount;
            let rowIDSeed = oldState.rowIDSeed;

            for (const update of updates) {
                const index = (!update.index && update.index !== 0) ? dataRowCount : update.index;
                for (const [field, newValue] of Object.entries(update)) {
                    if (field === 'index') continue;
                    if (field in newColumnarData) {
                        newColumnarData[field] = [...newColumnarData[field]];
                    } else {
                        newColumnarData[field] = new Array(oldState.dataRowCount);
                    }
                    if (newDataColumns.indexOf(field) < 0) newDataColumns.push(field);
                    newColumnarData[field][index] = newValue;
                }
                newColumnarData._gyde_rowid[index] = `r${rowIDSeed++}`;
                ++dataRowCount
            }

            return {
                columnarData: newColumnarData,
                dataColumns: newDataColumns,
                dataRowCount,
                rowIDSeed
            };
        });
    }

    updateDatumKV(index, updates) {
        this.setState((oldState) => {
            const newColumnarData = {...oldState.columnarData};
            const newDataColumns = [...oldState.dataColumns];

            for (const [field, newValue] of Object.entries(updates)) {
                if (field in newColumnarData) {
                    newColumnarData[field] = [...newColumnarData[field]];
                } else {
                    newColumnarData[field] = new Array(oldState.dataRowCount);
                }
                if (newDataColumns.indexOf(field) < 0) newDataColumns.push(field);
                newColumnarData[field][index] = newValue;
            }

            return {
                columnarData: newColumnarData,
                dataColumns: newDataColumns,
            };
        });
    }

    updateDatum(indexOrIndices, field, newValue, addColumn=false, forceVisible=false) {
        if (forceVisible) this.toggleMSADataField(field, 'add');

        if (indexOrIndices instanceof Array) {
            // do nothing
        } else if (indexOrIndices instanceof Set) {
            indexOrIndices = Array.from(indexOrIndices);
        } else {
            indexOrIndices = typeof(indexOrIndices) === 'number' ? [indexOrIndices] : [];
        }
        this.setState((oldState) => {
            const newColumnarData = {...oldState.columnarData};
            const newDataColumns = [...oldState.dataColumns];

            if (newDataColumns.indexOf(field) < 0) newDataColumns.push(field);

            if (field in newColumnarData) {
                newColumnarData[field] = [...newColumnarData[field]];
            } else {
                newColumnarData[field] = [];
                newColumnarData[field].length = oldState.dataRowCount;
            }

            for (const index of indexOrIndices) {
                newColumnarData[field][index] = newValue;
            }

            const update = {
                columnarData: newColumnarData
            };
            if (addColumn && newDataColumns.length > oldState.dataColumns.length) {
                update.dataColumns = newDataColumns;
            }

            return update;
        })
    }

    addValueToNewStructureColumn(index, value, newColumn, forceVisible=true) {
        if (newColumn !== 'predicted_structure' && forceVisible) this.toggleMSADataField(newColumn, 'add');
        
        this.setState((oldState) => {
            const newColumnarData = {...oldState.columnarData};
            if (newColumn in newColumnarData) {
                newColumnarData[newColumn] = [...newColumnarData[newColumn]];
            } else if (!!value) {

                const newCol = []
                for (let i = 0; i < oldState.dataRowCount; i++) newCol.push(null);
                newColumnarData[newColumn] = newCol;
            }
            
            newColumnarData[newColumn][index] = value;

            const newStructureKeys = [...oldState.structureKeys];
            if (!newStructureKeys.includes(newColumn)) {
                 newStructureKeys.push(newColumn);
            }
            
            const update = {
                columnarData: newColumnarData,
                structureKeys: newStructureKeys
            }

            if (oldState.dataColumns.indexOf(newColumn) < 0) {
                update.dataColumns = [...oldState.dataColumns];
                update.dataColumns.push(newColumn);
            }

            return update;
        })
    }

    referenceOptions = memoize((alignmentTargets, hasSeeds, isAntibody) => {
        const options = [];
        if (isAntibody) {
            for (const {name} of alignmentTargets.filter(target => !target.numberingOnly)) {
                options.push({key: name, name})
            }
            options.push({key: '_seed', name: 'Seeds', disabled: !hasSeeds});
            for (const {name} of alignmentTargets.filter(target => !target.numberingOnly)) {
                options.push({key: `_seed+${name}`, name: `Seed ${name} GL`, disabled: !hasSeeds})
            }
        }
        return options;
    });

    setAutoSuperpose(x) {
        this.setState({
            autoSuperpose: x
        });
    }

    doAddColumn(type) {
        this.setState({showAddColumn: type})
    }
}

function prepareSequencesColumnar(columnarData, seqCol=[], suffix='', noFilter=false) {
    const nameCol = columnarData['_gyde_rowid'] || [];

    return seqCol.map((seq, idx) => {
        let sname = nameCol[idx]?.replace(/\s/g, '_');
        if (!sname) sname = '_gyde_seq_' + idx;
        if (suffix) sname = sname + suffix;

        return {
            // Matching the properties made by msa.io.fasta.  Not totally
            // sure that all of these are actually needed...
            name: sname,
            id: idx,
            ids: {},
            details: {'en': sname},
            seq
        }
    }).filter((s) => noFilter || s.seq);
}


function AddColumn({show, onHide, onAdd, existingColumns}) {
    const [name, setName] = useState();

    useEffect(() => {
        if (show) {
            const baseName = 'user_' + show;
            if (existingColumns.indexOf(baseName) >= 0) {
                for (let i = 2; ; ++i) {
                    const addName = baseName + '_' + i;
                    if (existingColumns.indexOf(addName) < 0) {
                        setName(addName);
                        break;
                    }
                }
            } else {
                setName(baseName);
            }
        }
    }, [show]);

    const nameIsUnique = existingColumns.indexOf(name) < 0;

    return (
        <Dialog open={show} onClose={onHide} aria-labelledby="col-dialog-title">
            <DialogTitle id="col-dialog-title">
                Add new {show || ''} column
            </DialogTitle>

            <DialogContent>
                <TextField id="name"
                           label="Column name"
                           onChange={(ev) => setName(ev.target.value)}
                           value={name}
                           fullWidth
                           margin="normal" />

                { nameIsUnique
                  ? null
                  : <div style={{color: 'red'}}>Name must be unique</div> }
            </DialogContent>

            <DialogActions>
                <Button onClick={(ev) => onAdd(name, show)} color="primary" disabled={!nameIsUnique}>
                    Add column
                </Button>
                <Button onClick={onHide} color="secondary">
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )

}

let _paste_id_seed = 0;
function SetupMerge({show, onHide, onDataLoad, updateTab, thisSession, loadedSessions=[]}) {
    const [mergeDatasetKey, setMergeDatasetKey] = useState();
    const [mergedSession, setMergedSession] = useState();
    const [mergeIssues, setMergeIssues] = useState();

    const [data, setData] = useState();
    const [dataErr, setDataErr] = useState();

    const [uploadedSession, setUploadedSession] = useState();
    const [uploadedSessionValid, setUploadedSessionValid] = useState(false);
    const uploadCallback = useCallback((dataset, valid) => {
        setUploadedSession(dataset);
        setUploadedSessionValid(valid);
    }, []);

    const candidateSessions = loadedSessions.filter((s) => s.id !== thisSession.id);
    const session = loadedSessions.filter((s) => s.id === mergeDatasetKey)[0];

    const onPaste = useCallback(async () => {
        try {
            const data = await tableFromClipboard();
            data.key = `_paste${_paste_id_seed++}`

            if (data.length) {
                setUploadedSession(undefined);
                setData(data);
                setDataErr(undefined);
                setMergeDatasetKey(undefined);
            }
        } catch (err) {
            alert(err?.message || err)
        }
    }, [setData]);

    const selectDataFile = useCallback(async (ev) => {
        const file = ev.target.files[0];
        if (! (file instanceof Blob)) {
            return;
        }

        let fileName = file.name;
        if (fileName) {
            const dotIndex = fileName.lastIndexOf('.');
            if (dotIndex > 0) {
                fileName = fileName.substring(0, dotIndex);
            }
        }

        try {
            const raw = await readAsArrayBuffer(file);
            let ss = loadSpreadsheet(raw, file.name.endsWith('.csv') ? 'csv' : 'xlsx');
            let lastNonEmpty = -1;
            for (let i = 0; i < ss.length;  ++i) {
                if (ss[i] && ss[i].length > 0) {
                    lastNonEmpty = i;
                }
            }
            if (lastNonEmpty > 0 && lastNonEmpty < ss.length - 1) {
                ss.splice(lastNonEmpty + 1);
            }

            ss.name = fileName;
            setUploadedSession(undefined);
            setData(ss);
            setDataErr(undefined);
            setMergeDatasetKey(undefined);
        } catch (err) {
            setUploadedSession(undefined);
            setData(undefined);
            setDataErr(err.message || err);
        }
    }, [setData, setDataErr]);

    const createTabFromMerged = useCallback(() => {
        const newSession = {
            ...(mergedSession || []),
            name: `${thisSession.name} X ${session?.name || 'Uploaded'}`
        };
        delete newSession.id;
        delete newSession.showSetupMerge;
        delete newSession._external_id;
        delete newSession._gyde_readonly;
        delete newSession.updateTabProps;

        onDataLoad(undefined, newSession);
        onHide();
    }, [mergedSession, onHide, onDataLoad, thisSession, session]);

    const updateTabFromMerged = useCallback(() => {
        if (!window.confirm('Are you sure you want to replace the current tab contents?  This can not (currently) be undone!')) return;

        const newSession = {
            ...(mergedSession || []),
            name: `${thisSession.name} X ${session?.name || 'Uploaded'}`
        };
        delete newSession.id;
        delete newSession.showSetupMerge;
        delete newSession._external_id;
        delete newSession._gyde_readonly;
        delete newSession.updateTabProps;

        updateTab(newSession);
        onHide();
    }, [mergedSession, onHide, onDataLoad, thisSession, session]);

    return (
        <Dialog open={show} onClose={onHide} aria-labelledby="merge-dialog-title" maxWidth="80vw">
            <DialogTitle id="merge-dialog-title">
                Merge datasets
            </DialogTitle>

            <DialogContent
                sx={{
                    xwidth: '40vw',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '25px',
                }}
            >
                <DialogContentText>
                    Select another loaded dataset to merge, either by column or by row name.
                </DialogContentText>
                <Grid container sx={{minWidth: '40rem'}} spacing={2}>
                    <Grid item xs={7}>
                        <FormControl fullWidth>
                            <InputLabel id="ds-label">
                                { candidateSessions.length
                                    ? "Dataset to merge"
                                    : "Open more datasets to use merge facility" }
                            </InputLabel>
                            
                            <Select margin="dense"
                                    labelId="ds-label"
                                    size="small"
                                    id="ds"
                                    value={mergeDatasetKey ?? '-'}
                                    label="Dataset type"
                                    disabled={candidateSessions.length === 0}
                                    onChange={(ev) => setMergeDatasetKey(ev.target.value)}>
                                { candidateSessions.map((s) => (
                                    <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                                )) }
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={1}>
                        ...or...
                    </Grid>
                    <Grid item xs={2} style={{display: 'flex', alignItems: 'stretch', justifyItems: 'stretch'}}>
                        <div style={{width: '100%'}}>
                            <input id="upload-seqs"
                                   type="file"
                                   accept="text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                                   onChange={ selectDataFile  }
                                   style={{display: 'none'}} />
                            <label htmlFor="upload-seqs">
                                <Tooltip title="Upload a spreadsheet or CSV file of data to merge"> 
                                    <Button variant="outlined"
                                            component="div"
                                            style={{height: "100%", width: "100%"}}
                                            color="primary">
                                        <Upload />
                                   </Button> 
                                </Tooltip>
                            </label>
                        </div>
                    </Grid>
                    <Grid item xs={2} style={{display: 'flex', justifyItems: 'stretch', alignItems: 'stretch'}}>
                        <Tooltip title="Paste tabular data from the clipboard">
                            <Button variant="outlined" onClick={ onPaste } sx={{width: '100%'}}>
                                <Paste />
                            </Button>
                        </Tooltip>
                    </Grid>

                    { dataErr
                      ? <Grid item xs={12} style={{color: 'red'}}>{ dataErr}</Grid> 
                      : undefined }
                </Grid>

                { !mergeDatasetKey && data
                    ? <DataTableConfigurator key={data?.name || data?.key}
                                             rawData={data}
                                             callback={uploadCallback}
                                             syntheticNames={false} />
                    : undefined }

                { (session || uploadedSession)
                    ? <div style={{width: '76vw'}}>
                         <BindConfig key={session?.id || data?.name || data?.key} 
                                     thisSession={thisSession}
                                     extSession={session || uploadedSession}
                                     resultCallback={(session, issues) => {
                                        setMergedSession(session);
                                        setMergeIssues(issues);
                                     }} />
                      </div>
                    : undefined }


            </DialogContent>

            <DialogActions>
                <Button onClick={createTabFromMerged}
                        disabled={!mergedSession || mergeIssues?.length}>
                    Merge datasets
                </Button>
                <Button onClick={updateTabFromMerged}
                        disabled={!mergedSession || mergeIssues?.length}
                        color="error">
                    Merge and replace dataset
                </Button>
                <Button onClick={onHide} color="secondary">
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}


function JobViewDialog({jobId, explicitURL, onHide}) {
    return (
        <Dialog open={!!(jobId || explicitURL)}
                onClose={onHide}
                maxWidth="60vw">
            <DialogTitle>
                Inspect analysis job
                <IconButton
                    aria-label="close"
                    onClick={onHide}
                    sx={{
                        position: 'absolute',
                        right: 8,
                        top: 8,
                    }}
                >
                    <Close/>
                </IconButton>
            </DialogTitle>

            <DialogContent style={{minWidth: '70rem'}}>
                { (jobId || explicitURL)
                  ? <JobView key={explicitURL || jobId} jobId={jobId} explicitURL={explicitURL} />
                  : undefined }
            </DialogContent>
        </Dialog>
    )
}


export default function Study(props) {
    return (
        <PingerContext.Consumer>
            { (pinger) => (
                <SlivkaServiceContext.Consumer>
                    { (slivkaService) => (
                        <_Study {...props}
                                pinger={pinger}
                                slivkaService={slivkaService} />
                    ) }
                </SlivkaServiceContext.Consumer>
            ) }
        </PingerContext.Consumer>
    )
}
