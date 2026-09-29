import {isTamarindCompute} from '../compute';
import {parseTamarindDesign, tamarindDesignProbabilities} from '../integrations/tamarind/tamarindDesign';
import {parseTamarindTap} from '../integrations/tamarind/tamarindTap';
import md5 from 'md5';
import {csvParse} from 'd3-dsv';

import slivka from './slivka.js';
import {pause} from '../utils/utils';
import yauzl from 'yauzl';
import npyjs from 'npyjs';
import {readAsText} from '../utils/loaders';
import initWasm, { Table, writeParquet, WriterPropertiesBuilder, Compression, readParquet } from 'parquet-wasm';
import { tableFromArrays, tableToIPC, tableFromIPC } from 'apache-arrow';
import { average, stdev } from '../utils/math.js';

export function predictionKey(hc, lc) {
    return md5(hc + '*' + lc);
}

export async function predictedStructureABB(ss, hc, lc, slivkaOpts={}) {
    const formData = new FormData();
    formData.append('heavy', hc);
    formData.append('light', lc);
    formData.append('target_name', 'predicted');
    formData.append('renumber', 'kabat');

    const result = await slivka(
        ss,
        'abodybuilder',
        formData,
        [{label: 'Best predicted structure', type: 'blob'}],
        {useCache: true, ...slivkaOpts}
    );

    if (result) {
        const [{data}] = result;
        data.gyde_source = 'ABodyBuilder';
        return data;
    }
}


export async function molDesk(ss, structure, pH) {
    const formData = new FormData();
    formData.append('input', structure);
    formData.append('ph', pH);
    const [{data}] = await slivka(ss, 'moldesk', formData, [{label: 'Output file', type: 'text'}], true);

    return parseMolDesk(data);
}

function parseMolDesk(output) {
    const [headerLine, dataLine] = output.split('\n');
    const header = headerLine.split(/\s+/),
          data = dataLine.split(/\s+/).map((d) => parseFloat(d));
    const result = {};
    if (header.length !== data.length) throw Error('Malformed MolDesk output');
    for (let i = 0; i < data.length; ++i) {
        result[header[i]] = data[i];
    }
    return result;
}

export async function therapeuticAntibodyProfiler(ss, hc, lc) {
    const formData = new FormData();
    formData.append('seq', `${hc}/${lc}`);
    if(isTamarindCompute()) {
        const [{data}]=await slivka(ss,'tap',formData,[{label:'Tamarind TAP scores',type:'text'}],{useCache:true});
        return parseTamarindTap(data);
    }

    const results = await slivka(
        ss,
        'tap',
        formData, 
        [
            {'label': 'Output file', type: 'json'},
            {'label': 'CDR Length Graph data', type: 'json'},
            {'label': 'Patch CDR Positive Charge graph data', type: 'json'},
            {'label': 'Patch CDR Negative Charge graph data', type: 'json'},
            {'label': 'Patch CDR Surface Hydrophobicity graph data', type: 'json'},
            {'label': 'SFvCSP graph data', type: 'json'},
        ],
        true
    );

    const dataByLabel = {};
    for (const {label, data} of results) 
        dataByLabel[label] = data;

    return {
        ...flattenTAP(dataByLabel['Output file']),
        'graph_cdrlen': dataByLabel['CDR Length Graph data'],
        'graph_ppc': dataByLabel['Patch CDR Positive Charge graph data'],
        'graph_pnc': dataByLabel['Patch CDR Negative Charge graph data'],
        'graph_psh': dataByLabel['Patch CDR Surface Hydrophobicity graph data'],
        'graph_sfvcsp': dataByLabel['SFvCSP graph data']
    };
}

function flattenTAP(data) {
    const [abData] = Object.values(data);  // We only run TAP on one AB at a time.

    /*
    return {
        'TAP_CDR_length': abData.Flags.L,
        'TAP_Hydrophobicity': abData.Flags.PSH,
        'TAP_PosCharge': abData.Flags.PPC,
        'TAP_NegCharge': abData.Flags.PNC,
        'TAP_SFvCSP': abData.Flags.SFvCSP
    }
    */

    const hcData = Object.values(abData['Hydrophobicity and Charge'])[0]
    return {
        'Patch_Hydrophob_CDR': hcData['Patch_Hydrophob_CDR'],
        'Patch_Hydrophob_Total': hcData['Patch_Hydrophob_Total'],
        'Patch_Pos_Charge_CDR': hcData['Patch_Pos_Charge_CDR'],
        'Patch_Pos_Charge_Total': hcData['Patch_Pos_Charge_Total'],
        'Patch_Neg_Charge_CDR': hcData['Patch_Neg_Charge_CDR'],
        'Patch_Neg_Charge_Total': hcData['Patch_Neg_Charge_Total'],
        'TAP_SFvCSP': hcData['SFvCSP'],
        'TAP_CDR_Length': abData['Total CDR Length'],
        'H3_Length': abData['H3 Length']
    }
}


export async function rapidStabilityPrediction(ss, data, name, chain, chainData, mapping, nameColumn='concept_name', refNameColumn='seed', slivkaOpts) {
    const formData = new FormData();
    const structureBlob = new Blob([data], {type: 'chemical/x-pdb'});
    formData.append(
        'input',
        structureBlob,
        'input.pdb'
    );

    const [{data: results}] = await slivka(
        ss,
        'rasp',
        formData,
        [
            {'label': 'Output file', type: 'text'},
        ],
        {useCache: true, ...slivkaOpts}
    );

    const parsed = csvParse(results);

    const recordsByChain = {};
    for (const r of parsed) {
        if (!recordsByChain[r.chainid]) recordsByChain[r.chainid] = [];
        recordsByChain[r.chainid].push(r);
    }

    const chainRecords = recordsByChain[chain];
    for (const r of chainRecords) {
        const m = /^[A-Z](\d+)[A-Z]$/.exec(r.variant);
        r.pos = parseInt(m[1]);
        r.variant = r.variant.replace(r.pos, mapping[r.pos])
    }

    const wtSeq = chainData[chain].mpnnAtomicSequence.split('');
    const reverseResNumIndex = {};
    const residueNumbers = chainData[chain].mpnnNumbering.map((e, i) => {
        reverseResNumIndex[e] = i;
        return {start: i + 1, end: i + 1, value: {residueNumber: e}};
    });

    const alignment = chainRecords.map((record) => {
        const resNum = record.variant.substring(1, record.variant.length - 1);
        const pos = reverseResNumIndex[resNum];

        const mutSeq = [...wtSeq];
        if (typeof(pos) === 'number') {
            mutSeq[pos] = record.mt_AA;
        }

        return {
            seqid: record.variant,
            [nameColumn]: record.variant,
            [refNameColumn]: name,
            HC_sequence: mutSeq.join(''),
            HC_sequence_base: wtSeq.join(''),
            seed_HC_alignment: wtSeq.join(''),
            wt_nlf: parseFloat(record.wt_nlf),
            mt_nlf: parseFloat(record.mt_nlf),
            score_ml_fermi: parseFloat(record.score_ml_fermi),
            score_ml: parseFloat(record.score_ml),
            structure_url: structureBlob
        };
    });

    alignment.chain = chain;
    alignment.residueNumbers = residueNumbers;
    alignment.columns = ['seqid', nameColumn, 'HC_sequence', 'seed_HC_alignment', 'wt_nlf', 'mt_nlf', 'score_ml_fermi', 'score_ml'];
    return alignment;
}


function parseMpnnHeader(s) {
    const props = {};

    while (true) {
        s = s.trim();
        if (!s.length) return props;

        const eq = s.indexOf('=');
        let valEnd = eq + 1, quoteDepth = 0;
        while (valEnd < s.length && (quoteDepth > 0 || s[valEnd] !== ',')) {
            if (s[valEnd] === '[') quoteDepth++;
            if (s[valEnd] === ']') quoteDepth = Math.max(quoteDepth-1, 0);
            ++valEnd;
        }

        const k = s.substring(0, eq);
        let v = s.substring(eq+1, valEnd);
        if (/^-?\d+(\.\d+)?/.exec(v)) v = parseFloat(v);
        props[k] = v;

        if (valEnd < s.length) {
            s = s.substring(valEnd+1);
        } else {
            return props;
        }
    }
}


function* mpnnFastaParse(data, trimAll=false) {
    let props = {},
        seqLines = [];

    const makeSeq = () => {
        const record = {
            seq: seqLines.join(''),
            ...props

        }
        seqLines = []; props = {};
        return record;
    }

    let lineIndex = 0;
    for (const line of data.split('\n')) {
        ++lineIndex;
        if (line.length === 0) continue;
        if (line[0] === '>') {
            if (seqLines.length) yield makeSeq();

            let parseLine = line.substring(1);
            if (lineIndex === 1 || trimAll) {
                const comma = parseLine.indexOf(',');
                parseLine = parseLine.substring(comma+1);
            }

            Object.assign(props, parseMpnnHeader(parseLine));
        } else {
            seqLines.push(line.trim());
        }
    }

    if (seqLines.length) yield makeSeq();
}

export async function parseProteinMPNN(ss, jid, designMapping, chainData, saveProbabilities=false) {
    const MATRIX_LABEL = 'Output per-position probabilities (when save_probs is selected)',
          OUTPUT_LABEL = 'Output design file';

    const wantedFiles = [{
        'label': OUTPUT_LABEL,
        'type': 'text'
    }];

    wantedFiles.push({
        'label': MATRIX_LABEL,
        required: false,
        'type': 'arrayBuffer'    // could use "blob" instead depending on exactly what's going on downstream
    })
    
    const results = await ss.fetch(jid, wantedFiles);
    let output, npzBuffer;
    for (const {label, data} of results) {
        if (label === OUTPUT_LABEL) {
            output = data;
        } else if (label === MATRIX_LABEL) {
            npzBuffer = data;
        }
    }

    if (isTamarindCompute()) {
        const result=parseTamarindDesign(output, chainData, designMapping, '/');
        if(saveProbabilities) {
            const [{data}]=await ss.fetch(jid,[{label:'Tamarind probability heatmap',type:'json',required:true}]);
            result.probs=tamarindDesignProbabilities(data,chainData,designMapping);
        }
        return result;
    }
    const parsedResult = Array.from(mpnnFastaParse(output));
    if (npzBuffer) {
        try {
            const chainOrderBuffer = await extractFromZIP(Buffer.from(new Uint8Array(npzBuffer)), 'chain_order.npy');
            const chainOrderArray = new npyjs().parse(chainOrderBuffer.buffer);
            const chainOrder = [];
            for (let i = 0; i < chainOrderArray.shape[1]; ++i) {
                let chain = '';
                for (let ii = i*4; ii < i*4+4; ++ii) {
                    const x = chainOrderArray.data[ii];
                    if (x > 0) chain = chain + String.fromCharCode(x);
                }
                chainOrder.push(chain)
            }

            const matrixMask = [];
            const chainLetterMask = [];

            chainOrder.forEach((chain) => {
                chainData[chain].mpnnNumbering.forEach((num, i) => {
                    chainLetterMask.push(chain);
                    // As of "generic structures" version, designMapping is now 1-based.
                    if (!!designMapping[chain] && designMapping[chain].includes(i+1) && num !== '') {
                        matrixMask.push(1);
                    } else {
                        matrixMask.push(0);
                    }
                })
            });

            const matrixBuffer = await extractFromZIP(Buffer.from(new Uint8Array(npzBuffer)), 'log_probs.npy');
            const parsed = new npyjs().parse(matrixBuffer.buffer);
            const shape = parsed.shape; // (designs, sequence positions, residues)

            const arrays = {}; 

            for (let j = 0; j < shape[1]; j++) {
                const chain = chainLetterMask[j];
                if (!arrays[chain]) arrays[chain] = [];
                const array = arrays[chain];

                const jj = array.length;
                array.push([]);
                for (let k = 0; k < shape[2]; k++) {
                    if (matrixMask[j] === 0) {
                        array[jj].push(null);
                    } else {
                        // average log probability matrices over designs
                        let avg = 0;
                        for (let i = 0; i < shape[0]; i++) {
                            avg += parsed.data[shape[1]*shape[2]*i + shape[2]*j + k];
                        }

                        // convert log-probability to normal probability
                        array[jj].push(Math.exp(avg/shape[0]));
                    }
                }
            }

            // array will have the shape (sequence_length, 21)
            parsedResult.probs = arrays;
        } catch (err) {
            console.log('matrix extraction failed', err);
        }
    }

    return parsedResult;
}

export async function parseLigandMPNN(ss, jid, designMapping, chainData) {
    const OUTPUT_LABEL = 'sequence';

    const wantedFiles = [{
        'label': OUTPUT_LABEL,
        'type': 'text'
    }];
    
    const results = await ss.fetch(jid, wantedFiles);
    let output;
    for (const {label, data} of results) {
        if (label === OUTPUT_LABEL) {
            output = data;
        } 
    }

    if (isTamarindCompute()) return parseTamarindDesign(output, chainData, designMapping);
    const parsedResult = Array.from(mpnnFastaParse(output, true));
    return parsedResult;
}

export function extractFromZIP(zipBuffer, fileName) {
    return new Promise((resolve, reject) => {
         yauzl.fromBuffer(zipBuffer, null, (err, zipfile) => {
            if (err) {
                reject(err);
                return;
            }

            let found = false;
            zipfile.on('entry', (entry) => {
                if (entry.fileName === fileName) {
                    found = true;
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            reject(err); return;
                        }
                        const bufs = [];
                        readStream.on('data', (d) => bufs.push(d));
                        readStream.on('end', () => {
                            resolve(Buffer.concat(bufs));
                        })
                    })
                }
            });
            zipfile.on('end', () => {
                zipfile.close();
                if (!found) reject('Could not find ' + fileName);
            });

        });
    })
}

// assumed that reference or base sequence is the first row in the dataset
export async function rosettaMutationEnergy(slivkaService, columnarData, seqColumns, soloSelection) {
    let structureBlob;
    if (columnarData.structure_url) {
        structureBlob = columnarData.structure_url[0];
    } else if (columnarData.predicted_structure) {
        structureBlob = columnarData.predicted_structure[0];
    }

    const sequenceData = {};
    seqColumns.forEach((col) => sequenceData[col.column] = columnarData[col.column][soloSelection]);

    const sequenceLabels = seqColumns.map((col) => col.column);
    const referenceSequences = seqColumns.map((col) => col.data[0]);
    const numberings = seqColumns.map((col) => col.numbering);

    const mutatedSequences = sequenceLabels.map((label) => sequenceData[label])
    const chains = columnarData.structure_chains[soloSelection];

    const formData = new FormData();
    formData.append(
        'input',
        structureBlob,
        'input.pdb'
    );

    // populate formData
    chains.forEach((chain, i) => {
        const referenceSequence = referenceSequences[i];
        const mutatedSequence = mutatedSequences[i];
        const numbering = numberings[i];

        mutatedSequence.split('').forEach((res, pos) => {
            if (res !== referenceSequence[pos]) {
                const mutationString = `${chain}.${numbering[pos]}${res}`;
                //mutationStrings.push(mutationString);
                formData.append('residue', mutationString);
            }
        });
    })

    const [{data: results}] = await slivka(
        slivkaService,
        'model_rosetta_energy',
        formData,
        [{'label': 'Energy change (ddG)', 'type': 'text'}],
        {useCache: false}
    );
    
    return results;
}

export async function parseBoltzPLDDTs(npzBuffer) {
    const matrixBuffer = await extractFromZIP(Buffer.from(new Uint8Array(npzBuffer)), 'plddt.npy');
    const matrix = new npyjs().parse(matrixBuffer.buffer);
    return matrix.data;
}
