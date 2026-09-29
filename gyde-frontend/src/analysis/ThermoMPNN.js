import {isTamarindCompute} from '../compute';
import {TamarindThermoMPNNDialog} from '../integrations/tamarind/TamarindThermoMPNN';
import React, {useState} from 'react';
import {
    Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Table,
    TableContainer, TableRow, TableBody, TableCell, TableHead, Divider, MenuItem, LinearProgress,
    Switch, Input
} from "@mui/material";
import { Close } from "@mui/icons-material";
import {csvParse} from 'd3-dsv';

import {readAsText} from '../utils/loaders';
import {getPdbChains} from '../utils/pdb';
import { aosToSoa } from '../utils/utils';
import slivka from './slivka.js';
import { usePinger } from '../Pinger';
import { parseStructureData } from '../structureView/utils';

import { useSlivka } from '../czekolada/lib';

const SlivkaThermoMPNNDialog = (props) => {
    const { open, onClose, passedProps } = props;
    const {
        columnarData, soloSelection, structureKeys, onDataLoad
    } = passedProps;

    const nameColumn = 'concept_name',
          refNameColumn = 'seed';

    const [structureRaw, setStructureRaw] = useState(null);
    const [structureDataBlob, setStructureDataBlob] = useState(null);
    const [dataErr, setDataErr] = useState(null);
    const [jobName, setJobName] = useState('');
    const [analysisRunning, setAnalysisRunning] = useState(null);
	const [analysisError, setAnalysisError] = useState(null);
    const [analysisStatus, setAnalysisStatus] = useState(null);
    const [chainData, setChainData] = useState(null);
    const [chain, setChain] = useState('');

    const availStructureKeys = structureKeys.filter((k) => !!columnarData[k] && !!columnarData[k][soloSelection]);
    const [structureKey, setStructureKey] = useState(null);

    const reset = () => {
        setStructureDataBlob(null);
        setDataErr(null);
        setJobName('')
        setAnalysisError(null);
        setChainData(null);
        setChain('');
        setStructureKey(null);
    }

    const onHide = () => {
        onClose();
        reset();
    }

    const selectStructure = async (key) => {
        try {
            const structureData = columnarData[key][soloSelection];

            if (!structureData) return;
            const {structureText, format}  = await parseStructureData(structureData);
            if (format !== 'pdb') {
                throw Error('Only support PDB inputs for now');
            }

            setStructureKey(key);

            const chains = await getPdbChains(structureText);

            setChainData(chains);
            setStructureDataBlob(new Blob([structureText], {type: 'chemical/x-pdb'}));
            setStructureRaw(structureData);
            setDataErr(null);
        } catch (err) {
            setStructureDataBlob(null);
            setDataErr(err.message || err);
        }
    }

    const pinger = usePinger();
    const [numResults, setNumResults] = useState(100);
    const [useAllResults, setUseAllResults] = useState(true);

    const slivkaService = useSlivka();

    const runThermoMPNN = async () => {
        try {
            pinger('analysis.thermompnn');

            setAnalysisRunning(true);
            setAnalysisError(undefined);

            const formData = new FormData();
            const structureBlob = new Blob([structureDataBlob], {type: 'chemical/x-pdb'});

            formData.append('input', structureBlob, 'input.pdb');
            formData.append('chain', chain);

            const [{data: results}] = await slivka(
                slivkaService,
                'thermompnn',
                formData,
                [
                    {'label': 'Mutations stability prediction', type: 'text'},
                ],
                {
                    useCache: true,
                    statusCallback: ({status}) => setAnalysisStatus(status)
                }
            );

            const parsedResults = csvParse(results);

            const wtSeq = chainData[chain].mpnnAtomicSequence.split('');
            const residueNumbers = chainData[chain].mpnnNumbering.map((e, i) => {
                return {start: i + 1, end: i + 1, value: {residueNumber: e}};
            });

            const alignment = parsedResults.map(r => {
                const mutSeq = [...wtSeq];
                mutSeq[r.position] = r.mutation;
                const mutationString = `${r.wildtype}${residueNumbers[r.position].value.residueNumber}${r.mutation}`;

                return {
                    seqid: mutationString,
                    [nameColumn]: mutationString,
                    [refNameColumn]: jobName,
                    sequence: mutSeq.join(''),
                    sequence_base: wtSeq.join(''),
                    seed_alignment: wtSeq.join(''),
                    ddG_pred: parseFloat(r.ddG_pred),
                    structure_url: structureRaw
                };
            })

            alignment.chain = chain;
            alignment.residueNumbers = residueNumbers;
            alignment.columns = ['seqid', nameColumn, refNameColumn, 'sequence', 'seed_alignment', 'ddG_pred'];

            const scores = alignment.map(r => r.ddG_pred);
			scores.sort((a, b) => a-b);

            let thresholded = alignment;

            if (!useAllResults) {
                const scoreThreshold = scores.length >= numResults ? scores[numResults - 1] : scores[scores.length-1];
                thresholded = alignment.filter((r) => r.ddG_pred <= scoreThreshold);
            }

            const thresholdedWithRef = [{
                seqid: 'ref',
                [nameColumn]: 'ref',
                [refNameColumn]: jobName,
                sequence: wtSeq.join(''),
                sequence_base: wtSeq.join(''),
                seed_alignment: wtSeq.join(''),
                ddG_pred: 0,
                structure_url: structureRaw
            }].concat(thresholded)

            const gydeData = aosToSoa(thresholdedWithRef);
            gydeData.seqid = gydeData[nameColumn];
            gydeData.structure_chains = thresholdedWithRef.map((_) => [alignment.chain]);
            gydeData.structure_residue_numbering = thresholdedWithRef.map((_) => [alignment.residueNumbers]);

            onDataLoad(undefined, {
                columnarData: gydeData,
                dataColumns: alignment.columns,
                dataRowCount: thresholdedWithRef.length,
                alignmentKey: 'seqs',
                seqColumns: [{column: 'sequence', numbering: alignment.residueNumbers.map((r) => r?.value?.residueNumber || '')}],
                seqColumnNames: ['Chain ' + alignment.chain],
                seqRefColumns: [{column: 'sequence_base'}],
				isAntibody: false,
                isHeatmapVisible: true,
                heatmapSelectedColumn: 'ddG_pred',
                msaDataFields: ['Names', 'ddG_pred'],
                nameColumn,
                refNameColumn,
				name: `ThermoMPNN: ${jobName ? jobName : ''}`
			});
            setAnalysisRunning(false);

        } catch (err) {
			setAnalysisRunning(false);
			setAnalysisError(err.message || err);
		}
    }

    let chainList;
    if (chainData) chainList = Object.keys(chainData);

    return (
        <Dialog
            open={open}
            onClose={onHide}
        >
            <DialogTitle>
                Run ThermoMPNN
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

            <DialogContent
                sx={{
                    width: '40vw',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '25px',
                }}
            >
                <TextField
                    id="rasp-structure-select"
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

                {(!!structureDataBlob && chainList.length > 0)
                ?
                <React.Fragment>
                    <Divider/>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Chain</TableCell>
                                    <TableCell>Sequence</TableCell>
                                </TableRow>
                            </TableHead>

                            <TableBody>
                                {chainList && chainList.map((chain) => (
                                    <TableRow key={chain}>
                                        <TableCell>{chain}</TableCell>
                                        <TableCell>{chainData[chain]['rawAtomicSequence']}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <Stack direction='row' gap='10px'>
                        <TextField
                            id="round-select"
                            label="Chain to analyse"
                            value={ chain || ''}
                            style={{width: '8rem'}}
                            select
                            error={chainData && !chain}
                            helperText={(chain || !chainData) ? undefined : 'Select a chain'}
                            onChange={(ev) => setChain(ev.target.value)}
                        >
                            { (chainList || []).map(chain => (
                                <MenuItem key={ chain } value={ chain }>{ chain }</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            label="Job name"
                            fullWidth
                            type='text'
                            value={jobName}
                            onKeyDown={(ev) => ev.stopPropagation()}
                            onChange={(ev) => setJobName(ev.target.value)}
                        />
                    </Stack>
                    <Stack direction='row' gap='10px' alignItems={'center'}>
                        <div
                            style={{userSelect: 'none', opacity: useAllResults? '100%' : '30%'}}
                        >
                            All results
                        </div>
                        <Switch
                            checked={!useAllResults}
                            onChange={() => setUseAllResults(!useAllResults)}/>
                        <div
                            style={{userSelect: 'none', opacity: useAllResults? '30%' : '100%'}}
                        >
                            top
                        </div>
                        <Input
                            value={numResults}
                            onChange={(ev) => setNumResults(ev.target.value)}
                            inputProps={{
                                step: 1,
                                min: 0,
                                max: 10000,
                                type: 'number',
                            }}
                            style={{maxWidth: '4rem', opacity: useAllResults? '30%' : '100%'}}
                        />
                    </Stack>
                </React.Fragment>
                : null
                }
                { dataErr ?
                    <div style={{color: 'red'}}>
                        { dataErr }
                    </div>
                    : null
                }
                { analysisError ?
                    <div style={{color: 'red'}}>
                        { analysisError }
                    </div>
                    : null
                }
                { analysisRunning ?
                    <div>
                        <div style={{
                            textAlign: 'center',
                            paddingBottom: '4px',
                            fontWeight: '700',
                            color: '#777777'
                        }}>
                            { analysisStatus }
                        </div>
                        <LinearProgress />
                    </div>
                    : null
                }
            </DialogContent>

            <DialogActions>
                <Button
                    variant={'contained'}
                    onClick={runThermoMPNN}
                    disabled={false}
                >
                    Run
                </Button>
                <Button onClick={onHide}>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export function ThermoMPNNDialog(props) {
    return isTamarindCompute() ? <TamarindThermoMPNNDialog {...props}/> : <SlivkaThermoMPNNDialog {...props}/>;
}
