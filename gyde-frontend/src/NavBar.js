import TamarindLogo from './integrations/tamarind/TamarindLogo';
import {isTamarindCompute} from './compute';
import React, { useCallback, useState, useContext, createContext } from "react";
import {
    Button, Checkbox, Divider, ListItemText, ListItemIcon, Menu, MenuItem, 
    Stack, Tooltip, Radio, CircularProgress
} from "@mui/material";
import { ArrowRight, ArrowDropDown, OpenInNew, Download, Check, Merge,
    Share as Restraint, Error } from "@mui/icons-material";
import RaSPDialog from "./analysis/RaSPDialog";
import { ThermoMPNNDialog } from "./analysis/ThermoMPNN";
import { rosettaMutationEnergy } from "./analysis/analysis";
import { useEnvironment } from './Environment';
import GMenu, {GDropDown, GMenuItem, GSubMenu, ExplainDisabledMenuItem, MenuCloseContext, useCloseMenus} from './utils/GMenu';

import {useSlivka, useSlivkaService} from './czekolada/lib';

// TODO: move this to another file
export const navbarButtonCSS = {
    color: 'primary.text',
    fontSize: 16,
    paddingLeft: '6px',
    paddingRight: '6px',
    paddingTop: '3px',
    paddingBottom: '3px',
    border: '1px solid',
    borderRadius: '10px',
    borderColor: '#b4cfdb',
    textTransform: 'none',
    transition: "background-color 0s",

    ':hover': {
        backgroundColor: '#b4cfdb',
    }
}

const alignmentKeyMap = {
    'alignedSeqs': 'MSA (MAFFT)',
    'anarciSeqs': isTamarindCompute() ? 'Kabat (ANARCI)' : 'Kabat (AbSolve)'
}


export const NavBar = (props) => {
    const [activeJobs, setActiveJobs] = useState([]);

    const buttonStyle = {
        ...navbarButtonCSS,
        fontSize: props.compact ? '10px' : '14px',
        padding: props.compact ? '1px' : null,
        borderRadius: props.compact ? '5px' : '10px',
    };

    if (props.showTableMenuOnly) {
        return (
            <Stack direction='row'
                       sx={{
                        alignItems: 'stretch',
                        gap: props.compact ? '0px' : '5px',
                        mb: '5px'
                    }}>
                <TableMenu
                    compact={props.compact}
    
                    columns={props.columns}
                    seqColumns={props.seqColumns}
                    seqColumnNames={props.seqColumnNames}
                    selected={props.selected}
                    toggle={props.toggle}
                    heatmapSelectedColumn={props.heatmapSelectedColumn}
    
                    selection={props.selection}
                    showExportOptions={props.showExportOptions}
                    doFilter={props.doFilter}
                    doUnfilter={props.doUnfilter}
                    filter={props.filter}
                    tableFilters={props.tableFilters}
                    doSelectAll={props.doSelectAll}
                    doSelectNone={props.doSelectNone}
                    doInvertSelection={props.doInvertSelection}
                    doInvertSelectedColumns={props.doInvertSelectedColumns}

                    columnFilter={props.columnFilter}
                    selectedColumns={props.selectedColumns}
                    doColumnFilter={props.doColumnFilter}
                    doColumnUnfilter={props.doColumnUnfilter}
                    doColumnFilterByHeatmap={props.doColumnFilterByHeatmap}
                    doColumnFilterByNonGap={props.doColumnFilterByNonGap}

                    doAddColumn={props.doAddColumn}
                    showMerge={props.showMerge}
                    showSelectByIndex={props.showSelectByIndex}
                    createRestraintFromSelection={props.createRestraintFromSelection}
                />
                <Button
                    sx={buttonStyle}
                    onClick={props.showExportOptions}>
                    Download
                    <Download />
                </Button>
            </Stack>
        )
    } else {
        return (
            <Stack
                direction='row' 
                sx={{
                    alignItems: 'stretch',
                    gap: props.compact ? '0px' : '5px',
                    mb: '5px'
                }}
            >
                <DisplayMenu
                    compact={props.compact}
    
                    msaColors={props.msaColors}
                    highlightCDRs={props.highlightCDRs}
                    colourBackground={props.colourBackground}
                    colourScheme={props.colourScheme}
                    setColorScheme={props.setColorScheme}
    
                    msaTypefaces={props.msaTypefaces}
                    typefaceName={props.typefaceName}
                    setTypefaceName={props.setTypefaceName}
                    fontSize={props.fontSize}
                    setFontSize={props.setFontSize}
    
                    isSequenceLogoVisible={props.isSequenceLogoVisible}
                    toggleSequenceLogoVisibility={props.toggleSequenceLogoVisibility}

                    isHeatmapVisible={props.isHeatmapVisible}
                    setHeatmapVisibility={props.setHeatmapVisibility}
                    heatmapSelectedColumn={props.heatmapSelectedColumn}
                    setHeatmapSelectedColumn={props.setHeatmapSelectedColumn}
                    columns={props.columns}
                    matrixDataObject={props.matrixDataObject}
                />
                <TableMenu
                    compact={props.compact}
    
                    columns={props.columns}
                    seqColumns={props.seqColumns}
                    seqColumnNames={props.seqColumnNames}
                    selected={props.selected}
                    toggle={props.toggle}
                    heatmapSelectedColumn={props.heatmapSelectedColumn}
    
                    selection={props.selection}
                    showExportOptions={props.showExportOptions}
                    doFilter={props.doFilter}
                    doUnfilter={props.doUnfilter}
                    filter={props.filter}
                    tableFilters={props.tableFilters}
                    doSelectAll={props.doSelectAll}
                    doSelectNone={props.doSelectNone}
                    doInvertSelection={props.doInvertSelection}
                    doInvertSelectedColumns={props.doInvertSelectedColumns}

                    columnFilter={props.columnFilter}
                    selectedColumns={props.selectedColumns}
                    doColumnFilter={props.doColumnFilter}
                    doColumnUnfilter={props.doColumnUnfilter}
                    doColumnFilterByHeatmap={props.doColumnFilterByHeatmap}
                    doColumnFilterByNonGap={props.doColumnFilterByNonGap}

                    doAddColumn={props.doAddColumn}
                    showMerge={props.showMerge}
                    showSelectByIndex={props.showSelectByIndex}
                    createRestraintFromSelection={props.createRestraintFromSelection}
                />
                <SeqMenu
                    compact={props.compact}
    
                    columns={props.columns}
                    seqColumns={props.seqColumns}
                    seqColumnNames={props.seqColumnNames}
                    selected={props.selected}
                    toggle={props.toggle}
                    heatmapSelectedColumn={props.heatmapSelectedColumn}
    
                    selection={props.selection}
                    showExportOptions={props.showExportOptions}
                    doFilter={props.doFilter}
                    doUnfilter={props.doUnfilter}
                    filter={props.filter}
                    tableFilters={props.tableFilters}
                    doSelectAll={props.doSelectAll}
                    doSelectNone={props.doSelectNone}
                    doInvertSelection={props.doInvertSelection}
                    doInvertSelectedColumns={props.doInvertSelectedColumns}

                    columnFilter={props.columnFilter}
                    selectedColumns={props.selectedColumns}
                    doColumnFilter={props.doColumnFilter}
                    doColumnUnfilter={props.doColumnUnfilter}
                    doColumnFilterByHeatmap={props.doColumnFilterByHeatmap}
                    doColumnFilterByNonGap={props.doColumnFilterByNonGap}

                    doAddColumn={props.doAddColumn}
                    showMerge={props.showMerge}
                    showSelectByIndex={props.showSelectByIndex}
                    createRestraintFromSelection={props.createRestraintFromSelection}
                />
                <Divider orientation='vertical' flexItem sx={{margin: '5px'}}></Divider>
                <AnalysisMenu
                    compact={props.compact}
    
                    tap={props.tap}
                    moldesk={props.moldesk}
                    humanize={props.humanize}
                    mpnn={props.mpnn}
                    ligandMPNN={props.ligandMPNN}
                    structureKeys={props.structureKeys}
                    columnarData={props.columnarData}
                    seqColumnData={props.seqColumnData}
                    hcColumn={props.hcColumn}
                    lcColumn={props.lcColumn}
                    soloSelection={props.soloSelection}
                    selection={props.selection}
                    onDataLoad={props.onDataLoad}
                    isDNA={props.isDNA}
                    isAntibody={props.isAntibody}
                    toggle={props.toggle}
                    addDataByIndex={props.addDataByIndex}
                    addDataByIndices={props.addDataByIndices}
                    activeJobs={activeJobs}
                    setActiveJobs={setActiveJobs}
                />

                <Stack
                    direction='row' 
                    ref={props.primaryNavBarExtrasRef}
                    sx={{
                        alignItems: 'center',
                        gap: props.compact ? '0px' : '5px'
                    }}
                >
                </Stack>

                <Divider orientation='vertical' flexItem sx={{margin: '5px'}}></Divider>
                <Button
                    sx={buttonStyle}
                    onClick={props.showExportOptions}>
                    Download
                    <Download />
                </Button>

                <div style={{flexGrow: 1}}></div>

                <AlignByMenu
                    compact={props.compact}
    
                    onChange={props.alignByMenuOnChange}
                    specialAlign={props.specialAlign}
                    wasHumanized={props.wasHumanized}
                    alignmentKey={props.alignmentKey}
                    isAntibody={props.isAntibody}
                    alignmentStatus={props.alignmentStatus}
                    alignmentError={props.alignmentError}
                />
                <ReferenceSequenceMenu
                    compact={props.compact}
                    
                    onChange={props.targetSequenceMenuOnChange}
                    wasHumanized={props.wasHumanized}
                    isAntibody={props.isAntibody}
                    alignmentTarget={props.alignmentTarget}
                    referenceOptions={props.referenceOptions}

                    explicitReference={props.explicitReference}
                    setExplicitReference={props.setExplicitReference}
                    seqNames={props.seqNames}
                    selection={props.selection}
                    setSuppressDatasetReference={props.setSuppressDatasetReference}
                    suppressDatasetReference={props.suppressDatasetReference}
                    hasDatasetReference={props.hasDatasetReference}
                />
            </Stack>
        )
    }
}


/// ===============================
/// ========== SUB-MENUS ==========
/// ===============================

const AlignByMenu = (props) => {
    const {onChange, specialAlign, wasHumanized, alignmentKey, isAntibody, compact, alignmentStatus={}, alignmentError} = props;
    const running = Object.values(alignmentStatus).some((x) => x);

    return (
        <GDropDown name={
                        <React.Fragment>
                            Align by: {(alignmentKeyMap[alignmentKey] ?? specialAlign) || '-'}
                            {running 
                                ? <CircularProgress size={12}/> 
                                : alignmentError 
                                    ? <Tooltip title={alignmentError?.message || alignmentError || 'Alignment failed'}>
                                        <Error sx={{color: 'red'}} /> 
                                      </Tooltip>
                                    : undefined }
                        </React.Fragment> }
                   id="align-by-menu"
                   compact={compact}>
            <GMenuItem
                value='alignedSeqs'
                onClick={onChange}>
                MSA (MAFFT) {alignmentStatus.mafft ? <CircularProgress size={12}/> : null}
            </GMenuItem>
            <GMenuItem
                value='anarciSeqs'
                disabled={!isAntibody}
                onClick={onChange}>
                {alignmentKeyMap.anarciSeqs}
            </GMenuItem>
            {specialAlign 
            ? <GMenuItem
                value={specialAlign}
                onClick={onChange}>
                {specialAlign}
            </GMenuItem>
            : null }
        </GDropDown>
    )
}

const ReferenceSequenceMenu = (props) => {
    const {onChange, referenceOptions,
        alignmentTarget, wasHumanized, isAntibody, compact, selection,
        setExplicitReference, explicitReference, seqNames=[],
        suppressDatasetReference, setSuppressDatasetReference, hasDatasetReference
    } = props;

    const onSelect = useCallback((ev) => {
        onChange(ev.target.attributes.value.value);
    }, [onChange]);

    const onSelectDatasetReference = useCallback(((ev) => {
        onChange(null);
        setExplicitReference(null);
    }), [onChange, setExplicitReference]);

    const onSelectNone = useCallback(((ev) => {
        onChange(null);
        setExplicitReference(null);
        setSuppressDatasetReference();
    }), [onChange, setExplicitReference, setSuppressDatasetReference]);

    const onSelectExplicit = useCallback((ev) => {
        setExplicitReference(Array.from(selection)[0]);
    }, [setExplicitReference, selection]);

    let ref = undefined;
    if (typeof(explicitReference) === 'number') {
        ref = seqNames[explicitReference] || '???';
    } else {
        ref ||= referenceOptions.filter(({key}) => key === alignmentTarget)[0]?.name
    }
    if (!ref && hasDatasetReference && !suppressDatasetReference) {
        ref = 'provided by dataset'
    }
    ref ||= '-';

    return (
        <GDropDown name={`Reference sequence: ${ ref }`}
                   id="reference-sequence-menu"
                   compact={compact}>
            <GMenuItem
                onClick={onSelectNone}>
                    None
            </GMenuItem>
            <GMenuItem
                onClick={onSelectExplicit}
                disabled={!selection || selection.size !== 1}>
                    Use selection as ref.
            </GMenuItem>
            <GMenuItem
                onClick={onSelectDatasetReference}
                disabled={!hasDatasetReference}
                divider>
                    Use dataset references
            </GMenuItem>
            { referenceOptions.map(({key, name, disabled}) => (
                <GMenuItem
                    key={key}
                    value={key}
                    onClick={onSelect}
                    disabled={disabled}>
                        {name}
                </GMenuItem>
            )) }
        </GDropDown>
    )
}

const DisplayMenu = (props) => {
    const {
        isSequenceLogoVisible, toggleSequenceLogoVisibility,
        msaColors, highlightCDRs, setColorScheme, msaTypefaces, typefaceName, setTypefaceName,
        setHeatmapVisibility, columns, heatmapSelectedColumn, setHeatmapSelectedColumn,
        compact, matrixDataObject, fontSize, setFontSize, colourBackground, colourScheme
    } = props

    return (
        <GDropDown name="Display"
                   id="display"
                   compact={compact}>
            <ColorSchemeMenu
                msaColors={msaColors}
                highlightCDRs={highlightCDRs}
                colourBackground={colourBackground}
                colourScheme={colourScheme}
                setColorScheme={setColorScheme}
            />
            <FontMenu
                msaTypefaces={msaTypefaces}
                typefaceName={typefaceName}
                setTypefaceName={setTypefaceName}
            />
            <FontSizeMenu
                fontSize={fontSize}
                setFontSize={setFontSize} />
            <GMenuItem noClose onClick={toggleSequenceLogoVisibility}>
                <ListItemText>Sequence Logo</ListItemText>
                <Checkbox checked={isSequenceLogoVisible}/>
            </GMenuItem>
            <HeatmapColumnsMenu
                setHeatmapVisibility={setHeatmapVisibility}
                heatmapSelectedColumn={heatmapSelectedColumn}
                setHeatmapSelectedColumn={setHeatmapSelectedColumn}
                columns={columns}
                matrixDataObject={matrixDataObject}
            />
        </GDropDown>
    );
}

const AnalysisMenu = (props) => {
    const {
        tap, moldesk, humanize, mpnn, ligandMPNN, structureKeys,
        columnarData, soloSelection, onDataLoad, isDNA, seqColumnData, toggle,
        addDataByIndex, addDataByIndices, activeJobs, setActiveJobs, isAntibody, selection,
        hcColumn, lcColumn, compact
    } = props;

    const slivkaService  = useSlivka();
    const environment = useEnvironment();

    // TODO 09/23/2024: generalize to all jobs
    const [analysisCounts, setAnalysisCounts] = useState({
        'ddG': 0,
    })

    const onJobSubmit = (serviceName) => {
        const jobNumber = analysisCounts[serviceName] + 1;
        const jobString = `${serviceName}_${jobNumber}`;

        setActiveJobs((activeJobs) => {
            const newActiveJobs = [...activeJobs];
            newActiveJobs.push(jobString);
            return newActiveJobs;
        });
        setAnalysisCounts((analysisCounts) => {
            const newAnalysisCounts = {...analysisCounts};
            newAnalysisCounts[serviceName] += 1;
            return newAnalysisCounts;
        })

        return jobString;
    }

    const onJobConclude = (jobString) => {
        setActiveJobs((activeJobs) => {
            const newActiveJobs = activeJobs.filter((job) => job !== jobString);
            return newActiveJobs;
        })
    }

    // TODO: allow multiple jobs to be run
    // TODO 09/23/2024: broken for Prescient datasets 
    const runDDG = async () => {
        const jobString = onJobSubmit('ddG');
        const result = await rosettaMutationEnergy(slivkaService, columnarData, seqColumnData, soloSelection);
        onJobConclude(jobString);

        addDataByIndex({ΔΔG: result}, soloSelection);
        toggle('ΔΔG', 'add');
    }

    const ligandMPNNService = useSlivkaService('ligand_mpnn'),
          thermoMPNNService = useSlivkaService('thermompnn'),
          proteinMPNNService_base = useSlivkaService('mpnn_design_residues'),
          proteinMPNNService_v = useSlivkaService('mpnn_design_residues-1.0.1'),
          proteinMPNNService = proteinMPNNService_base || proteinMPNNService_v,
          raspService = useSlivkaService('rasp'),
          ddgService = useSlivkaService('model_rosetta_energy');

    const tapService = useSlivkaService('tap'),
          mdService = useSlivkaService('moldesk');


    return (
        <GDropDown compact={compact}
                   style={{backgroundColor: 'primary.blue', color: 'white'}}
                   name={<React.Fragment>Compute {activeJobs.length > 0 ? <CircularProgress size={12}/> : null}</React.Fragment>}
                   id="compute-menu">
            <GSubMenu name="Antibody properties">
                { tapService &&<ExplainDisabledMenuItem
                    disabled={!tap}
                    onClick={tap}
                    disabledMessage="Requires antibody dataset, and at least one selected sequence"
                >
                    <span>TAP{isTamarindCompute() && <TamarindLogo/>}</span>
                </ExplainDisabledMenuItem> }
                { mdService && <ExplainDisabledMenuItem
                    disabled={!moldesk}
                    onClick={moldesk}
                    disabledMessage="Requires antibody dataset, and at least one selected sequence"
                >
                    MolDesk
                </ExplainDisabledMenuItem> }
                {!isTamarindCompute() && <ExplainDisabledMenuItem
                    disabled={!humanize}
                    onClick={humanize}
                    disabledMessage="Requires one selected sequence, and 'kabat' alignment mode"
                >
                    Humanize
                </ExplainDisabledMenuItem>}
            </GSubMenu>
            <GSubMenu name="Protein engineering">
                {proteinMPNNService && <ExplainDisabledMenuItem
                    disabled={!mpnn}
                    onClick={mpnn}
                    disabledMessage="Requires one selected sequence, and some selected columns."
                    style={{display: 'flex', justifyContent: 'space-between'}}
                >
                    <span>ProteinMPNN{isTamarindCompute() && <TamarindLogo/>}</span>
                    <OpenInNew/>
                </ExplainDisabledMenuItem>}
                { environment?.featureFlags?.ligandMPNN && ligandMPNNService
                  ? <ExplainDisabledMenuItem
                       disabled={!ligandMPNN}
                       onClick={ligandMPNN}
                       disabledMessage="Requires one selected sequence, and some selected columns."
                       style={{display: 'flex', justifyContent: 'space-between'}}
                    >
                        <span>LigandMPNN{isTamarindCompute() && <TamarindLogo/>}</span>
                        <OpenInNew/>
                    </ExplainDisabledMenuItem>
                  : undefined }
                { raspService && <RaSPMenu
                    structureKeys={structureKeys}
                    columnarData={columnarData}
                    soloSelection={soloSelection}
                    onDataLoad={onDataLoad}
                    isDNA={isDNA}
                /> }
                { thermoMPNNService && <ThermoMPNNMenu
                    structureKeys={structureKeys}
                    columnarData={columnarData}
                    soloSelection={soloSelection}
                    onDataLoad={onDataLoad}
                    isDNA={isDNA}
                /> }
                { ddgService && <ExplainDisabledMenuItem
                    enabledMessage="Calculate the Rosetta ΔΔG for all mutations in the selected sequence against the reference sequence"
                    disabledMessage="requires one selected sequence that isn't a reference sequence"
                    disabled={!soloSelection || soloSelection === 0}
                    noClose
                    onClick={runDDG}
                >
                    Calculate ΔΔG
                    {activeJobs.filter((name) => name.includes('ddG')).length > 0 ? <CircularProgress size={12}/> : null}
                </ExplainDisabledMenuItem> }
            </GSubMenu>
        </GDropDown>
    )
}

const TableMenu = (props) => {
    const {
        selection, doFilter, doUnfilter,
        showExportOptions, filter, tableFilters, columns, selected, toggle,
        doSelectAll, doSelectNone, columnFilter,
        seqColumns, seqColumnNames, doAddColumn, showMerge, showSelectByIndex, 
        doColumnFilterByNonGap, doInvertSelection, doInvertSelectedColumns,
        compact
    } = props;
    const [columnsAnchor, setColumnsAnchor] = useState(null);
    const [isColumnsMenuOpen, setIsColumnsMenuOpen] = useState(false);

    const showColumnsMenu = (event) => {
        setColumnsAnchor(event.currentTarget);
        setIsColumnsMenuOpen(true);
    }
    
    const hideColumnsMenu = () => {
        setIsColumnsMenuOpen(false);
    }

    return (
        <GDropDown name="Data"
                   id="data-menu"
                   compact={compact}>
            <GMenuItem
                onClick={doFilter}
                disabled={!selection || selection.size === 0}>
                Filter selected rows
            </GMenuItem>
            <GMenuItem 
                onClick={doUnfilter}
                disabled={!filter && Object.values(tableFilters).filter(x => x).length === 0}>
                Show all rows
            </GMenuItem>
            <GMenuItem onClick={doSelectAll}>Select all rows</GMenuItem>
            <GMenuItem onClick={doSelectNone}>Select no rows</GMenuItem>
            <GMenuItem onClick={doInvertSelection} divider>Invert selection</GMenuItem>
            
            <ColumnsMenu
                anchor={columnsAnchor}
                isOpen={isColumnsMenuOpen}
                onHide={hideColumnsMenu}
                onShow={showColumnsMenu}

                columns={columns}
                selected={selected}
                toggle={toggle}
                seqColumns={seqColumns}
                seqColumnNames={seqColumnNames}

                doAddColumn={doAddColumn}
            />
            <GMenuItem 
                onClick={showMerge}
            >
                Merge with another dataset
                <Merge />
            </GMenuItem>
        </GDropDown>
    )
}

const SeqMenu = (props) => {
    const {
        anchor, showMenu, selection, columns, selected, toggle,
        doSelectAll, doSelectNone, columnFilter, selectedColumns,
        doColumnFilter, doColumnUnfilter, doColumnFilterByHeatmap, heatmapSelectedColumn,
        seqColumns, seqColumnNames, doAddColumn, showMerge, showSelectByIndex, 
        doColumnFilterByNonGap, doInvertSelection, doInvertSelectedColumns,
        createRestraintFromSelection, compact
    } = props;

    return (
        <GDropDown name={ compact ? 'Seq. Vis' : 'Sequence Visualization'  }
                   id="seqvis-menu"
                   compact={compact}>
            <GMenuItem
                onClick={doColumnFilter}
                disabled={!selectedColumns}>
                Filter selected MSA columns
            </GMenuItem>
            <GMenuItem
                onClick={doColumnFilterByNonGap}>
                Hide gapped MSA columns
            </GMenuItem>
            <GMenuItem
                onClick={doColumnFilterByHeatmap}
                disabled={!heatmapSelectedColumn}>
                Hide MSA columns without heatmap data
            </GMenuItem>
            <GMenuItem 
                onClick={doColumnUnfilter}
                disabled={!columnFilter}>
                Show all MSA columns
            </GMenuItem>
            <GMenuItem onClick={doInvertSelectedColumns}>Invert MSA column selection</GMenuItem>
            <GMenuItem disabled={!selection || selection.size !== 1} 
                       onClick={showSelectByIndex} 
                       noClose
                       divider>
                Select MSA column by index/residue
            </GMenuItem>
            
            <GMenuItem 
                onClick={createRestraintFromSelection}
            >
                Create restraint from selected positions
                <Restraint />
            </GMenuItem>
        </GDropDown>
    )
}

/// ===============================
/// ======== SUB-SUB-MENUS ========
/// ===============================

const ColorSchemeMenu = (props) => {
    const {
       msaColors, setColorScheme, colourScheme, highlightCDRs, colourBackground
    } = props;

    return (
        <GSubMenu name="Color Scheme">
            { msaColors.map(({name}, index) => (
                <GMenuItem
                    divider={index === msaColors.length - 1}
                    key={name}
                    onClick={setColorScheme}
                    value={name}
                    noClose>
                    <Radio checked={colourScheme===name} value={name} />
                    { name }
                </GMenuItem>
            ))}
            <GMenuItem
                value="__hcdr"
                onClick={setColorScheme}
                noClose
            >
                <Radio checked={highlightCDRs} value="__hcdr" />
                Highlight CDRs
            </GMenuItem>
            <GMenuItem
                value="__colour_background"
                onClick={setColorScheme}
                noClose
            >
                <Radio checked={colourBackground} value="__colour_background" />
                Colour background
            </GMenuItem>
        </GSubMenu>
    )
}

const FontMenu = (props) => {
    const {msaTypefaces, typefaceName, setTypefaceName} = props;

    const onClick = (ev) => {
        setTypefaceName(ev.currentTarget.dataset?.typeface);
    }

    return (
        <GSubMenu name="Font">
            { msaTypefaces.map(({name}) => (
                <GMenuItem
                    key={name}
                    onClick={onClick}
                    data-typeface={name}>
                    { typefaceName === name
                        ? <ListItemIcon><Check /></ListItemIcon>
                        : null }

                    <ListItemText inset={typefaceName !== name}>{ name }</ListItemText>
                </GMenuItem>
            ))}
        </GSubMenu>
    )
}

const FontSizeMenu = (props) => {
    const {setFontSize, fontSize=12, fontSizes=[10, 12, 14, 18, 20, 24]} = props;

    const onClick = (ev) => {
        setFontSize(parseInt(ev.currentTarget.dataset?.fs));
    }

    return (
        <GSubMenu name="Font size">
             { fontSizes.map((s) => (
                    <GMenuItem                        
                        key={s}
                        onClick={onClick}
                        data-fs={s}>

                        { fontSize === s 
                            ? <ListItemIcon><Check /></ListItemIcon>
                            : null }
                        <ListItemText inset={fontSize !== s}>{ s }</ListItemText>
                    </GMenuItem>
                )) }
        </GSubMenu>
    )
}

const ColumnsMenu = (props) => {
    const {
        anchor, isOpen, onShow, onHide, columns, selected, toggle, seqColumns, seqColumnNames, 
        doAddColumn
    } = props;

    const onItemClick = useCallback((ev) => {
        if (ev.currentTarget.dataset.fieldname && toggle) {
            toggle(ev.currentTarget.dataset.fieldname)
        }
    }, [toggle]);

    const filteredColumns = columns.filter((column) => !column.hiddenByColumnsButton);

    return (
        <div
            onMouseEnter={onShow}
            onMouseLeave={onHide}>
            <MenuItem
                style={{display: 'flex', justifyContent: 'space-between'}}>
                Show/hide data columns
                <ArrowRight></ArrowRight>
            </MenuItem>
            <Menu
                id="column-menu"
                hideBackdrop="true"
                sx={{ pointerEvents: 'none' }}
                slotProps={{paper: {sx: {pointerEvents: 'auto'}}}}
                anchorEl={anchor}
                open={isOpen}
                onClose={onHide}
                anchorOrigin={{vertical: 'top', horizontal: 'right'}}
                transformOrigin={{vertical: 'top', horizontal: 'left'}}
            >
                { (seqColumns || []).map(({column}, index) => (
                    <MenuItem 
                        key={`seq-${column}`}
                        onClick={onItemClick}
                        data-fieldname={column}
                        divider={seqColumns && index === seqColumns.length - 1}
                    >
                        <Checkbox checked={selected ? (selected.indexOf(column) >= 0) : false} />
                        <ListItemText>{(seqColumnNames || [])[index] || `Sequence ${index + 1}`}</ListItemText>
                    </MenuItem>
                )) }
                { filteredColumns.map((column, index) => (
                    <MenuItem
                        key={column.field}
                        onClick={onItemClick}
                        data-fieldname={column.field}
                        divider={index === filteredColumns.length - 1}
                    >
                        <Checkbox checked={selected ? (selected.indexOf(column.field) >= 0) : false} />
                        <ListItemText>{column.title}</ListItemText>
                    </MenuItem>
                )) }
                <MenuItem onClick={(ev) => {onHide(); doAddColumn('rating')}}>
                    Add rating column...
                </MenuItem>
                <MenuItem onClick={(ev) => {onHide(); doAddColumn('note')}}>
                    Add notes column...
                </MenuItem>
            </Menu>
        </div>
    )
}

const HeatmapColumnsMenu = (props) => {
    const {columns, setHeatmapVisibility, 
        heatmapSelectedColumn, setHeatmapSelectedColumn, matrixDataObject
    } = props;

    const toggleSelectedColumn = (ev) => {
        const targetColumn = ev.currentTarget.dataset.fieldname;

        if (targetColumn === heatmapSelectedColumn){
            setHeatmapSelectedColumn(null);
            setHeatmapVisibility(false);
        } else {
            setHeatmapSelectedColumn(targetColumn);
            setHeatmapVisibility(true);
        }
    }

    return (
        <GSubMenu name="Heatmap">
            { columns.filter((column) => !column.hiddenByColumnsButton).map((column) => (
                <GMenuItem
                    key={column.field}
                    onClick={toggleSelectedColumn}
                    data-fieldname={column.field}
                >
                    <Radio checked={(column.field === heatmapSelectedColumn)}/>
                    <ListItemText>{column.title}</ListItemText>
                </GMenuItem>
            )) }
            { Object.keys(matrixDataObject).map((key) => (
                    <GMenuItem
                    key={key}
                    onClick={toggleSelectedColumn}
                    data-fieldname={key}
                >
                    <Radio checked={(key === heatmapSelectedColumn)}/>
                    <ListItemText>{key}</ListItemText>
            </GMenuItem>
            ))}
        </GSubMenu>
    );
}

const RaSPMenu = (props) => {
    const {isDNA} = props;
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    return (
        <React.Fragment>
            <GMenuItem
                onClick={() => setIsDialogOpen(true)}
                noClose
                disabled={isDNA}
                style={{display: 'flex', justifyContent: 'space-between'}}
            >
                RaSP
                <OpenInNew/>
            </GMenuItem>
            <RaSPDialog
                open={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                passedProps={props}
            />
        </React.Fragment>
    )
}

const ThermoMPNNMenu = (props) => {
    const {isDNA} = props;

    const [isDialogOpen, setIsDialogOpen] = useState(false);

    return (
        <React.Fragment>
            <GMenuItem
                onClick={() => setIsDialogOpen(true)}
                disabled={isDNA}
                noClose
                style={{display: 'flex', justifyContent: 'space-between'}}
            >
                <span>ThermoMPNN{isTamarindCompute() && <TamarindLogo/>}</span>
                <OpenInNew/>
            </GMenuItem>
            <ThermoMPNNDialog
                open={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                passedProps={props}
            />
        </React.Fragment>
    )
}