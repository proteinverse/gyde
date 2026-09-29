import {isTamarindCompute} from '../compute';
import {designChainInputs} from './designChainInputs';
import {designPdb} from '../utils/designPdb';
import React, {useState, useCallback, useMemo, useEffect} from 'react';

import {
    CircularProgress, Button, TextField, Dialog, DialogTitle, DialogContent, DialogContentText, 
    DialogActions, Checkbox, Stack, MenuItem, LinearProgress
} from '@mui/material';

import { parseLigandMPNN } from './analysis';
import { getPdbChains, pdbToMmCifText } from '../utils/pdb';
import { parseStructureData } from '../structureView/utils';

import {usePinger} from '../Pinger';
import {useGydeWorkerService} from '../GydeWorkerService';
import {makeMappingsGeneric} from '../utils/structureUtils';
import {useSlivka, ServiceLauncher} from '../czekolada/lib';

export default function LigandMPNN({
    show,
    onDataLoad,
    onHide,
    seqColumns,
    seqColumnNames,
    selectedColumns = [],
    selection,
    columnarData,
    structureKeys=[],
    nameColumn='concept_name',
    sessionProps,
    alignments,
    ...props
}) {
    const soloSelection = useMemo(() => {
        return selection?.size === 1 ? Array.from(selection)[0] : undefined;
    }, [selection]);

    const availStructureKeys = useMemo(() => {
        return structureKeys.filter((k) => !!columnarData[k] && !!columnarData[k][soloSelection])
    }, [soloSelection, structureKeys, columnarData]);

    const [structureKey, setStructureKey] = useState(null);
    const [structureRaw, setStructureRaw] = useState(null);
    const [structureDataBlob, setStructureDataBlob] = useState(null);
    const [dataLoading, setDataLoading] = useState(false);
    const [dataErr, setDataErr] = useState(null);
    const [chainData, setChainData] = useState(null);
    const [chainMappings, setChainMappings] = useState(undefined);

    const [running, setRunning] = useState(false);
    const [jobStatus, setJobStatus] = useState();

    const pinger = usePinger();
    const slivkaService = useSlivka();
    const gydeWorkerService = useGydeWorkerService();

    const selectStructure = useCallback(async (key) => {
        try {
            setStructureKey(key);
            setDataLoading(true);
            setDataErr(undefined);
            setChainMappings(undefined);
            const structureData = columnarData[key][soloSelection];

            if (!structureData) return;
            let {structureText, format}  = await parseStructureData(structureData);
            if (isTamarindCompute()) {
                structureText = await designPdb(structureText, format);
                format = 'pdb';
            }
            if (format === 'pdb' && !isTamarindCompute()) {
                structureText = await pdbToMmCifText('----', structureText);
                format = 'mmcif';
            }
            if (format !== 'mmcif' && format !== 'pdb') {
                throw Error('Only support mmCIF or PDB inputs');
                // FIXME run through Mol* parsePDB->pdbToCif
            }
        
            const chains = await getPdbChains(structureText, format);
            setChainData(chains);
            setStructureDataBlob(new Blob([structureText], {type: format==='pdb' ? 'chemical/x-pdb' : 'chemical/x-mmcif'}));
            setStructureRaw(structureData);

            const mappings = await makeMappings(
                gydeWorkerService,
                chains,
                seqColumns.map((s) => (columnarData[s.column] || [])[soloSelection]),
                structureData._gyde_chains
            );
            setChainMappings(mappings);
        } catch (err) {
            console.log(err);
            setStructureDataBlob(null);
            setDataErr(err.message || err);
        } finally {
            setDataLoading(false);
        }
    }, [columnarData, soloSelection]);

    useEffect(() => {
        setStructureKey(undefined);
        setDataLoading(false);
        setDataErr(undefined);
        setChainMappings(undefined);
    }, [soloSelection])


    const {selectedItem, designChains, structureBlob, boundParams, validation, designMapping, warnings=[]} = useMemo(() => {
        if (selection?.size !== 1) {
            return {validation: 'Must select 1 item for LigandMPNN'};
        }

        if (!structureKey) {
            return {validation: 'Select a structure to proceed'};
        }

        if (!chainMappings) {
            return {validation: 'Determining residue mappings'};
        }

        if (!structureDataBlob) {
            return {validation: 'No structure'}
        }

        const {chains, mappings} = chainMappings;

        try {
            const selectedItem = Array.from(selection)[0];

            const designMapping = {};
            let missingColumns = false;
            let missingMaps = false;
            const warnings = [];

            for (let i = 0; i < seqColumns.length; ++i) {
                const aliColumn = alignments[i];
                if (selectedColumns[i]?.size > 0) {
                    const ali = aliColumn[selectedItem] || '';
                    const gapMap = [];
                    let cursor = 0;
                    for (let c = 0; c < ali.length; ++c) {
                        if (ali[c] && ali[c] !== '-') {
                            gapMap[c] = cursor++;
                        } else {
                            gapMap[c] = -1;
                        }
                    }

                    const chain = chains[i];                    
                    if (chain) { 
                        for (const cc of chain.split(',')) {
                            designMapping[cc] = Array.from(selectedColumns[i] || [])
                                .map((n) => gapMap[n])
                                .filter((n) => n >= 0)
                                .map((n) => (chainMappings.mappingsByChain?.[i]?.[cc] || [])[n])
                                .filter((v) => v?.value)
                                .map((v) => v.value);

                            if (designMapping[cc].length < selectedColumns[i].size) missingMaps=true;
                        }
                    } else {
                        missingColumns = true;
                    }
                }
            }

            if (isTamarindCompute() && (missingColumns || missingMaps)) {
                return {validation: 'Some selected residues could not be mapped. Adjust the selection before designing.'};
            }

            if (Object.keys(designMapping).length === 0) {
                for (let i = 0; i < seqColumns.length; ++i) {
                    const chain = chains[i];

                    if (!chain) {
                        warnings.push('No chains mapped to sequence column ' + (seqColumnNames ? seqColumnNames[i] : `Sequence ${i+1}`));
                    } else {
                        for (const cc of chain.split(',')) {
                            designMapping[cc] = Array.from((chainMappings.mappingsByChain?.[i]?.[cc] || []).filter((v) => v?.value).map((v) => v.value));
                        }
                    }
                }
            }

            Object.keys(designMapping).forEach((key) => designMapping[key].sort((x, y) => x-y));

            if (Object.keys(designMapping).length === 0) {
                return {validation: 'No valid target chains'};
            }

            const designChains = Object.keys(designMapping);

            if (missingColumns) {
                warnings.push('Not all sequences have been mapped to structure chains');
            }
            if (missingMaps) {
                warnings.push('Some selected positions could not be mapped onto the selected structure');
            }

            mappings.forEach((m, i) => {
                const cc = chains[i];
                if (!cc || !m) return;
                if (designMapping[cc.split(',')[0]]) {
                    if (m.perc_identity < 100 || m.perc_coverage < 100) {
                        warnings.push(`Non-identity residue mapping for chain ${cc}: ID=${Math.round(m.perc_identity)}%, Cov=${Math.round(m.perc_coverage)}%`);
                    }
                }
            });

            const rdr = [];
            for (const [chain, residues] of Object.entries(designMapping)) {
                for (const r of residues || []) {
                    rdr.push(`${chain}${r}`);
                }
            }

            return {
                boundParams:  {
                    'pdb_path': structureDataBlob,
                    'batch_size': 20,
                    'redesigned_residues': rdr.join(' ')
                },
                designChains,
                designMapping,
                structureBlob: structureDataBlob,
                selectedItem,
                warnings
            }
        } catch (err) {
            console.log(err);
            return {validation: 'Not a suitable dataset'};
        }
    }, [structureDataBlob, seqColumns, seqColumnNames, columnarData, selection, alignments, selectedColumns, chainMappings]);

    let unwatch = undefined;

    const updateJobStatus = useCallback(async (status) => {
        setRunning(!status.finished);
        setJobStatus(status.status);

        if (status.status === 'COMPLETED') {
            try {
                const sequenceData = {};
                seqColumns.forEach((col) => sequenceData[col.column] = columnarData[col.column][selectedItem]);

                const result = await parseLigandMPNN(slivkaService, status.id, designMapping, chainData);
                const headerRecord = result[0];
                const designedChains = isTamarindCompute() ? JSON.parse(headerRecord.designed_chains) : Object.keys(chainData);

                const seqRefColumns = seqColumns.map((c) => ({...c, column: `_gyde_${c.column}_refseq`}));
                const refSeqs = headerRecord.seq.split(':');

                const addData = result.map(({seq, id: sample, ...resultProps}) => {
                    const seqs = seq.split(':');

                    const record = {
                        structure_url: structureRaw,
                        structure_chains: chainMappings.chains.map((c) => c ? c.split(',')[0] : undefined),
                        [nameColumn]: sample ? 'lmpnn_sample_' + sample : 'reference',
                        seqid: sample ? 'lmpnn_sample_' + sample : 'reference',
                        score: resultProps.score,
                        ligand_confidence: resultProps.ligand_confidence,
                        overall_confidence: resultProps.overall_confidence,
                        seq_rec: resultProps.seq_rec,
                    };

                    for (let i = 0; i < seqColumns.length; ++i) {
                        record[seqColumns[i].column] = columnarData[seqColumns[i].column][selectedItem];
                        record[seqRefColumns[i].column] = columnarData[seqColumns[i].column][selectedItem];
                        const designIndex = designedChains.indexOf(record.structure_chains[i]);
                        if (designIndex >= 0) {
                            record[seqRefColumns[i].column] = refSeqs[designIndex];
                            record[seqColumns[i].column] = seqs[designIndex];
                        }
                    }
                    
                    return record;
                });
                addData.columns = ['ligand_confidence', 'overall_confidence', 'seq_rec'];

                const otherData = {};
                const probs = result.probs ? chainMappings.chains.map((chain) => result.probs[chain ? chain.split(',')[0]: undefined]) : undefined;
                if (probs) {
                    otherData.matrixDataObject= {'mpnn_probs': probs};
                    otherData.isHeatmapVisible = true;
                    otherData.heatmapSelectedColumn = 'mpnn_probs';
                }

                onDataLoad(addData, {
                    alignmentKey: 'seqs',
                    seqColumns: seqColumns,
                    seqRefColumns,
                    seqColumnNames: seqColumnNames,
                    isAntibody: sessionProps.isAntibody,
                    lcColumn: sessionProps.lcColumn,
                    hcColumn: sessionProps.hcColumn,
                    msaDataFields: ['Names'],
                    nameColumn,
                    name: `LigandMPNN: ${(columnarData[nameColumn] || [])[soloSelection] || '???'}`,
                    allowFrequencyAnalysis: true,
                    colourSchemeKey: 'Diffs. to master seq. (invert)',
                    ...otherData

                });
            } catch(err) {
                console.log(err);
            } finally {
                onHide();
            }
        } 
    }, [structureBlob, structureRaw, pinger, designChains, designMapping, chainMappings]);


    return (
        <Dialog open={show} onClose={onHide} aria-labelledby="mpnn-dialog-title">
            <DialogTitle id="mpnn-dialog-title">
                Design variants with LigandMPNN
            </DialogTitle>

            <DialogContent>
                <TextField
                    id="mpnn-structure-select"
                    label="Select structure"
                    value={structureKey ? structureKey : ''}
                    style={{width: '12rem'}}
                    margin='normal'
                    select
                    onChange={(ev) => selectStructure(ev.target.value)}
                >
                    { availStructureKeys.map((k) => (
                        <MenuItem key={k} value={k}>{k}</MenuItem>
                    )) }
                </TextField>

                { dataErr
                  ? <div style={{color: 'red'}}>{ dataErr }</div>
                  : dataLoading 
                    ? <LinearProgress />
                    : validation
                      ? <div style={{color: 'red'}}>{ validation }</div>
                      : <div>
                            { warnings.map((w, i) => (<div key={i} style={{color: 'red'}}>{ w }</div>)) }
                            <ServiceLauncher service="ligand_mpnn" 
                                             baseParams={boundParams}
                                             constrainParams={["pdb_path", "redesigned_residues", "redesigned_residues_multi", "fixed_residues", "fixed_residues_multi"]}
                                             hideParams={["pdb_path", "redesigned_residues_multi", "fixed_residues", "fixed_residues_multi"]}
                                             listener={updateJobStatus}
                                             slivkaOpts={{useCache: true}} 
                                             showProgress /> 
                        </div> }

            </DialogContent>
        </Dialog>
    )

}

async function makeMappings(gydeWorkerService, structureChains, sequences, chains) {
    const {sequences:seqByChain,residues:residueInfoByChain} = designChainInputs(structureChains, isTamarindCompute(), false);

    const mappings = await makeMappingsGeneric(gydeWorkerService, seqByChain, residueInfoByChain, sequences, chains);
    return mappings;
}
