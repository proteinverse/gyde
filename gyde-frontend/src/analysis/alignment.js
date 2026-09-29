import {isTamarindCompute} from '../compute';
import {parseAnarciCsv} from '../integrations/tamarind/tamarindAnarci';
import * as MSA from 'msa';

import slivka from './slivka.js';
import { trivialAlignment } from './trivialAlignment.js';

function fastaBlob(sequences) {
    return new Blob(
        [sequences.map(({name, seq}) => `>${name}\n${seq}\n`).join('')],
        {
            'type': 'application/fasta'
        }
    );
}

export async function mafftAlign(slivkaService, sequences, options = {}) {
    const trivial = trivialAlignment(sequences);
    if (trivial !== null) return trivial;

    const fasta = fastaBlob(sequences)

    const formData = new FormData()
    formData.append('input', fasta, 'input.fa');
    formData.append('part-tree', 'parttree');
    formData.append('sequence-type', 'amino acid');

    const [{data}] = await slivka(slivkaService, 'mafft-7.475', formData, [{label: 'alignment', type: 'text'}], {useCache: true, ...options});
    const alignment = MSA.io.fasta.parse(data);
    alignment.residueNumbers = alignment[0].seq.split('').map((_, i) => (i + 1).toString());
    return alignment;
}

export async function anarci(slivkaService, sequences, scheme='imgt') {
    if (isTamarindCompute()) {
        const results=[];
        // Keep submission fan-out bounded. Each Tamarind ANARCI job accepts one
        // sequence; retain caller names rather than the runner's generated ID.
        for (const sequence of sequences) {
            const form=new FormData();
            form.append('input',fastaBlob([sequence]),'input.fa');
            form.append('scheme',scheme);
            const files=await slivka(slivkaService,'anarci',form,
                [{label:'Numbering CSV',type:'text',required:false}],{useCache:true});
            const numbered=files.flatMap(({data})=>parseAnarciCsv(data,sequence));
            if(numbered.length!==1) throw Error(`ANARCI requires one recognized antibody domain for ${sequence.name}.`);
            const expected=sequence.name.endsWith('_heavy') ? 'H' : sequence.name.endsWith('_light') ? 'L' : null;
            if(expected && numbered[0].alignment.some(position=>position.chainName!==expected)) {
                throw Error(`The sequence in ${sequence.name} does not match its antibody chain type.`);
            }
            results.push(...numbered);
        }
        return results;
    }
    const fasta = fastaBlob(sequences)

    const formData = new FormData()
    formData.append('input', fasta, 'input.fa');
    formData.append('scheme', scheme);

    const [{data}] = await slivka(slivkaService, 'anarci', formData, [{label: 'Output file', type: 'text'}], true);
    return Array.from(anarciParse(data));
}

function* anarciParse(result) {
    // Largely ported from Gystics anarci.py

    const STATE_INIT = 1,
          STATE_PENDING_INFOHEADER = 2,
          STATE_PENDING_INFO = 3,
          STATE_PENDING_SCHEME = 4,
          STATE_ALI = 5;

    let state = STATE_INIT,
        seqName = null,
        score = null,
        expect = null,
        seqStart = null,
        seqEnd = null,
        header = null,
        chainName = null,
        alignment = null;

    for (const line of result.split('\n')) {
        if (!line) continue;

        switch (state) {
            case STATE_INIT:
                if (line.indexOf('# ') !== 0) throw Error(`Invalid header ${line}`);
                seqName = line.substring(2).split(' ')[0];
                state = STATE_PENDING_INFOHEADER;
                break;
            case STATE_PENDING_INFOHEADER:
                if (line === '//') {
                    state = STATE_INIT;
                } else if (line[0] !== '#') {
                    throw Error(`Invalid header ${line}`);
                } else if (line.indexOf('#|') === 0) {
                    header = line.substring(2).split('|');
                    state = STATE_PENDING_INFO;
                }
                break;
            case STATE_PENDING_INFO:
                if (line.indexOf('#') !== 0) {
                    throw Error(`Invalid header ${line}`);
                } else if (line.indexOf('#|') === 0) {
                    const infoList = line.substring(2).split('|');
                    const info = {};
                    for (let i = 0; i < header.length; ++i) info[header[i]] = infoList[i];
                    seqStart = parseInt(info['seqstart_index']) + 1;
                    seqEnd = parseInt(info['seqend_idnex']) + 1;  // NB coords are zero-based inclusive, NOT half-open.
                    expect = parseFloat(info['e-value']);
                    score = parseFloat(info['score']);

                    state = STATE_PENDING_SCHEME;
                }
                break;
            case STATE_PENDING_SCHEME:
                if (line.indexOf('# ') !== 0) {
                    throw Error(`Invalid header ${line}`);
                } else if (line.indexOf('# Scheme = ') === 0) {
                    chainName = null;
                    // console.log('scheme = ' + line.substring(11));
                    alignment = [];
                    state = STATE_ALI;
                }
                break;
            case STATE_ALI:
                if (line[0] === '#' || line === '//') {
                    // Occasionally, ANARCI gets an HMM match but isn't able
                    // to number it in the selected scheme.  We currently skip
                    // such cases.
                    if (alignment.length > 0) {
                        yield ({
                            seqName,
                            baseSeqStart: seqStart,
                            baseSeqEnd: seqEnd,
                            score,
                            expect,
                            alignment
                        });
                    }
                    
                    if (line === '//') {
                        state = STATE_INIT;
                    } else if (line.indexOf('# Domain') === 0) {
                        // There's another domain match for the same protein, we'll get a partial
                        // header then another alignment.
                        state = STATE_PENDING_INFOHEADER;
                    }
                } else {
                    chainName = line[0];

                    const modelPos = parseInt(line.substring(2, 6).trim());
                    const insertCode = line[8].trim();
                    const match = line[10];

                    alignment.push({chainName, modelPos, insertCode, match});
                }
                break;
        }
    }

    if (state !== STATE_INIT) throw Error(`Truncated ANARCI output. (state=${state})`)
}

export function anarciMakeAlign(results) {
    const insertsByPos = {};
    let maxPos = 0;
    for (const {alignment} of results) {
        for (const {modelPos, insertCode} of alignment) {
            maxPos = Math.max(maxPos, modelPos);
            if (insertsByPos[modelPos] === undefined) insertsByPos[modelPos] = new Set();
            if (insertCode) insertsByPos[modelPos].add(insertCode);
        }
    }

    const globalResidueNumbers = [];
    for (let pos = 1; pos <= maxPos; ++pos) {
        globalResidueNumbers.push(pos.toString());
        const inserts = [...(insertsByPos[pos] || [])];
        inserts.sort();
        for (const i of inserts) {
            globalResidueNumbers.push(pos.toString() + i);
        }
    }
    const alignment = results.map(({seqName, alignment}, idx) => {
        const augSeq = [];
        const augGL = [];
        const residueNumbers = [];
        let pos = 1;
        let ninsert = 0;
        for (const {chainName, modelPos, insertCode, match, germLine} of alignment) {
            while (modelPos > pos) {
                const expected = 1 + (insertsByPos[pos] ? insertsByPos[pos].size : 0);
                while (ninsert < expected) {
                    augSeq.push('-');
                    augGL.push('-');
                    ++ninsert;
                    residueNumbers.push(null);
                }
                ++pos;
                ninsert = 0;
            }
            augSeq.push(match);
            augGL.push(germLine || '-');
            residueNumbers.push(chainName + modelPos + insertCode)
            ++ninsert;
        }

        return {
            name: seqName,
            id: idx,
            ids: {},
            details: {'en': seqName},
            seq: augSeq.join(''),
            germLine: augGL.join(''),
            residueNumbers
        }
    });

    alignment.residueNumbers = globalResidueNumbers;
    return alignment;
}

export function juxtaposeAligns(ali1, ali2, template=null, gap=10) {
    if (!template) template = ali1;
    const a1len = ali1.map(({seq}) => seq.length).reduce((a, b) => Math.max(a, b));

    const a1byName = {}, a2byName = {};
    for (const a of ali1) a1byName[a.name] = a;
    for (const a of ali2) a2byName[a.name] = a;

    const juxt = [];
    for (let i = 0; i < template.length; ++i) {
        const templateRecord = template[i],
              a1record = a1byName[templateRecord.name] || {seq: ''},
              a2record = a2byName[templateRecord.name] || {seq: ''};

        const len = a1record.seq.length;
        const juxtRecord = {
            ...templateRecord,
            seq: a1record.seq + '-'.repeat(a1len+gap-len) + a2record.seq
        };
        if (a1record.residueNumbers) {
            juxtRecord.residueNumbers = [...a1record.residueNumbers];
            while (juxtRecord.residueNumbers.length < a1len+gap) juxtRecord.residueNumbers.push(null);
            for (const n of a2record.residueNumbers || []) juxtRecord.residueNumbers.push(n);
        }

        juxt.push(juxtRecord);
    }

    juxt.a1len = a1len;
    juxt.a2start = a1len + gap;

    return juxt
}

export function matchAligns(ali1, ali2, template=null) {
    if (!template) template = ali1;

    const a1byName = {}, a2byName = {};
    for (const a of ali1) a1byName[a.name] = a;
    for (const a of ali2) a2byName[a.name] = a;

    const match1 = [], match2 = [];
    for (let i = 0; i < template.length; ++i) {
        const templateRecord = template[i],
              a1record = a1byName[templateRecord.name] || {seq: ''},
              a2record = a2byName[templateRecord.name] || {seq: ''};

        match1.push({
            ...templateRecord,
            seq: a1record.seq,
            residueNumbers: a1record.residueNumbers,
            germLine: a1record.germLine
        });
        match2.push({
            ...templateRecord,
            seq: a2record.seq,
            residueNumbers: a2record.residueNumbers,
            germLine: a2record.germLine
        });
    }

    match1.residueNumbers = ali1.residueNumbers;
    match2.residueNumbers = ali2.residueNumbers;

    return [match1, match2];
}

export function matchAlign(ali1, template=null) {
    const a1byName = {};
    for (const a of ali1) a1byName[a.name] = a;

    const match1 = [];
    for (let i = 0; i < template.length; ++i) {
        const templateRecord = template[i],
              a1record = a1byName[templateRecord.name] || {seq: ''};

        match1.push({
            ...templateRecord,
            seq: a1record.seq,
            residueNumbers: a1record.residueNumbers,
            germLine: a1record.germLine
        });
    }

    match1.residueNumbers = ali1.residueNumbers;

    return match1;
}

export async function absolveProt(slivkaService, seqs) {
    const fasta = fastaBlob(seqs)

    const formData = new FormData()
    formData.append('input', fasta, 'input.fa');

    const results = await slivka(
        slivkaService,
        'absolve-prot',
        formData,
        [
            {label: 'Germ-line matches', type: 'text'},
            {label: 'VH database', type: 'text'},
            {label: 'JH database', type: 'text'},
            {label: 'VL database', type: 'text'},
            {label: 'JL database', type: 'text'}
        ],
        {useCache: true}
    );

    const resultsByLabel = {};
    for (const {label, data} of results) {
        resultsByLabel[label] = data;
    }

    return Array.from(absolveParseMulti(
        resultsByLabel['Germ-line matches'],
        {
            'VH': seqMap(fastaParse(resultsByLabel['VH database'])),
            'JH': seqMap(fastaParse(resultsByLabel['JH database'])),
            'VL': seqMap(fastaParse(resultsByLabel['VL database'])),
            'JL': seqMap(fastaParse(resultsByLabel['JL database']))
        }
    ));
}

function seqMap(seqs) {
    const map = {};
    for (const seq of seqs) {
        map[seq.name] = seq;
    }
    return map;
}

function* fastaParse(data) {
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

    for (const line of data.split('\n')) {
        if (line.length === 0) continue;
        if (line[0] === '>') {
            if (seqLines.length) yield makeSeq();

            const toks = line.substring(1).split('\t')
            props.name = toks[0];

            // Currently just supporting the "zoo" FASTA files from AbGrafter.
            if (toks.length == 2 && toks[1].indexOf('|') > 0) {
                const metaToks = toks[1].split('|');
                props.species = metaToks[2].split('_')[0];
            }

        } else {
            seqLines.push(line.trim());
        }
    }

    if (seqLines.length) yield makeSeq();
}

export async function absolveProtZoo(slivkaService, seqs) {
    const fasta = fastaBlob(seqs)

    const formData = new FormData()
    formData.append('input', fasta, 'input.fa');
    formData.append('multihit', '30');

    const results = await slivka(
        slivkaService,
        'absolve-zoo',
        formData,
        [
            {label: 'Germ-line matches', type: 'text'},
            {label: 'VH database', type: 'text'},
            {label: 'JH database', type: 'text'},
            {label: 'VL database', type: 'text'},
            {label: 'JL database', type: 'text'}
        ],
        {useCache: true}
    );

    const resultsByLabel = {};
    for (const {label, data} of results) {
        resultsByLabel[label] = data;
    }

    return Array.from(absolveParseMulti(
        resultsByLabel['Germ-line matches'],
        {
            'VH': seqMap(fastaParse(resultsByLabel['VH database'])),
            'JH': seqMap(fastaParse(resultsByLabel['JH database'])),
            'VL': seqMap(fastaParse(resultsByLabel['VL database'])),
            'JL': seqMap(fastaParse(resultsByLabel['JL database']))
        },
        true
    ));
}

export async function absolveProtPid(slivkaService, seqs) {
    const fasta = fastaBlob(seqs)

    const formData = new FormData()
    formData.append('input', fasta, 'input.fa');
    formData.append('multihit', '10');

    const results = await slivka(
        slivkaService,
        'absolve-prot',
        formData,
        [
            {label: 'Germ-line matches', type: 'text'},
            {label: 'VH database', type: 'text'},
            {label: 'JH database', type: 'text'},
            {label: 'VL database', type: 'text'},
            {label: 'JL database', type: 'text'}
        ],
        {useCache: true}
    );

    const resultsByLabel = {};
    for (const {label, data} of results) {
        resultsByLabel[label] = data;
    }

    return Array.from(absolveParseMulti(
        resultsByLabel['Germ-line matches'],
        {
            'VH': seqMap(fastaParse(resultsByLabel['VH database'])),
            'JH': seqMap(fastaParse(resultsByLabel['JH database'])),
            'VL': seqMap(fastaParse(resultsByLabel['VL database'])),
            'JL': seqMap(fastaParse(resultsByLabel['JL database']))
        },
        false,
        seqs
    ));
}

function* absolveParseMulti(data, dicts, matchSpecies, seqsForPID) {
    const [header, ...lines] = data.split('\n'),
          headerToks = header.split('\t');
    for (const line of lines) {
        if (!(line.trim().length)) continue;

        const toks = line.split('\t');
        const fields = {};
        for (let i = 0; i < headerToks.length; ++i) fields[headerToks[i]] = toks[i];

        const name = fields['Accession'], 
              seq = fields['ORF'],
              kabat = fields['Kabat'],
              glAlign = [],
              glRecomb = [];
        let lastVindex = 0;
        for (let i = 0; i < seq.length; ++i) glAlign.push('-');

        let type = 'unknown';

        let vSeq, jSeq;
        {
            // We always take the first (should be highest-scoring) match here, even in
            // multihit mode.

            const vhscores = fields['VHscore'].split(',').filter(s=>s.length>0).map((s) => parseInt(s)),
                  vlscores = fields['VLscore'].split(',').filter(s=>s.length>0).map((s) => parseInt(s));

            let glNames, glSeqs, glCigars, glPosns, glMismatches;

            if ((vhscores[0]||0) > (vlscores[0]||0)) {
                type = 'H'
                glNames = fields['VH'].split(',');
                glSeqs = glNames.map((n) => dicts.VH[n]);
                glCigars = fields['VHcigar'].split(',');
                glPosns = fields['VHpos'].split(',').map(s => (parseInt(s) -1 ));
                glMismatches = fields['VHshm'].split(',').map(s => parseInt(s));
            } else {
                type = 'L'
                glNames = fields['VL'].split(',');
                glSeqs = glNames.map((n) => dicts.VL[n]);
                glCigars = fields['VLcigar'].split(',');
                glPosns = fields['VLpos'].split(',').map(s => (parseInt(s) -1 ));
                glMismatches = fields['VLshm'].split(',').map(s => parseInt(s));
            }

            let index = 0;
            if (seqsForPID) {
                const glPIDs = [];
                for (let i = 0; i < glSeqs.length; ++i) {
                    glPIDs.push(((glSeqs[i].seq.length - glMismatches[i]) * 100.)/glSeqs[i].seq.length);
                }

                let maxPid = 0;
                for (let i = 0; i < glPIDs.length; ++i) {
                    if (glPIDs[i] > maxPid) {
                        maxPid = glPIDs[i];
                        index = i;
                    }
                }
            }

            const glName = glNames[index],
                  glSeq = glSeqs[index],
                  glCigar = glCigars[index];

            let glCursor = glPosns[index];
            let qCursor = 0;

            // Absolve alignments sometimes "trim" the start of the germline if they don't align well.  Include
            // them in the "full-recombined" reference anyway.
            //
            // Not doing this causes humanization issues for, e.g., ABP1AA59583
            for (let i = 0; i < glCursor; ++i) {
                glRecomb.push(glSeq.seq[i]);
            }

            for (const [_, cntStr, op] of glCigar.matchAll(/(\d*)([MIDS])/g)) {
                const cnt = cntStr ? parseInt(cntStr) : 1;
                for (let i = 0; i < cnt; ++i) {
                    if (op === 'S' || op === 'I') {
                        ++qCursor;
                    } else if (op === 'D') {
                        glRecomb.push(glSeq.seq[glCursor]);
                        ++glCursor;
                    } else if (op === 'M') {
                        glRecomb.push(glSeq.seq[glCursor]);
                        if (glAlign[qCursor] === '-') glAlign[qCursor] = glSeq ? glSeq.seq[glCursor] : 'X';
                        lastVindex = qCursor;
                        ++glCursor; ++qCursor;
                    } else {
                        throw Error(`Unexpected CIGAR op ${op}`);
                    }
                }
            }

            vSeq = glSeq;
        }

        {
            let glSeqs, glCigars, glPosns, glMismatches;

            if (type === 'H') {
                const glNames = fields['JH'].split(',');
                glSeqs = glNames.map((n) => dicts.JH[n]);
                glCigars = fields['JHcigar'].split(',');
                glPosns = fields['JHpos'].split(',').map(s => (parseInt(s) -1 ));
                glMismatches = fields['JHshm'].split(',').map(s => parseInt(s));
            } else if (type === 'L') {
                const glNames = fields['JL'].split(',');
                glSeqs = glNames.map((n) => dicts.JL[n]);
                glCigars = fields['JLcigar'].split(',');
                glPosns = fields['JLpos'].split(',').map(s => (parseInt(s) -1 ));
                glMismatches = fields['JLshm'].split(',').map(s => parseInt(s));
            }

            let glIndex = 0, glSeq, glCigar = '', glCursor = 0;

            if (seqsForPID) {
                if (matchSpecies) throw Error(`Don't currently support pid and matchSpecies modes together`);
                const glPIDs = [];
                for (let i = 0; i < glSeqs.length; ++i) {
                    glPIDs.push(((glSeqs[i].seq.length - glMismatches[i]) * 100.)/glSeqs[i].seq.length);
                }

                let maxPid = 0;
                for (let i = 0; i < glPIDs.length; ++i) {
                    if (glPIDs[i] > maxPid) {
                        maxPid = glPIDs[i];
                        glIndex = i;
                    }
                }
            }
            if (vSeq && vSeq.species && matchSpecies) {
                // If we have a species for the V segment, pick the highest-scoring J segment from
                // the same species, to match AbGrafter behaviour.
                glIndex = glSeqs.flatMap((seq, index) => {
                    if (seq && seq.species === vSeq.species) return [index];
                    return []
                })[0];
            }
            if (glIndex !== undefined) {
                glSeq = glSeqs[glIndex];
                glCigar = glCigars[glIndex] || '';
                glCursor = glPosns[glIndex] || 0;
            }

            let qCursor = 0;

            for (const [_, cntStr, op] of glCigar.matchAll(/(\d*)([MIDS])/g)) {
                const cnt = cntStr ? parseInt(cntStr) : 1;
                for (let i = 0; i < cnt; ++i) {
                    if (op === 'S') {
                        ++qCursor;
                    } else if (op === 'I') {
                        ++qCursor;
                    } else if (op === 'D') {
                        glRecomb.push(glSeq.seq[glCursor]);
                        ++glCursor;
                    } else if (op === 'M') {
                        if (qCursor > lastVindex + 1) {
                            for (let ins = lastVindex + 1; ins < qCursor; ++ins) {
                                glRecomb.push('X');
                            }
                            lastVindex = 1e9;
                        }
                        glRecomb.push(glSeq.seq[glCursor]);
                        if (glAlign[qCursor] === '-') glAlign[qCursor] = glSeq ? glSeq.seq[glCursor] : 'X';
                        ++glCursor; ++qCursor;
                    } else {
                        throw Error(`Unexpected CIGAR op ${op}`);
                    }
                }
            }

            jSeq = glSeq;
        }

        const numbering = kabat.split(' ')
            .filter((e) => e[0] === type)
            .map((s, i) => {
                const match = /^[HL](\d+)([A-Z]?)\.(.)$/.exec(s);
                return {
                    chainName: type,
                    modelPos: parseInt(match[1]),
                    insertCode: match[2] || '',
                    match: match[3],
                    germLine: glAlign[i]
                };
            });

        yield {
            seqName: name,
            baseSeqStart: 1,
            baseSeqEnd: seq.length,
            score: fields['HMMscore'],
            expect: null,
            alignment: numbering,
            germLine: (vSeq && jSeq) ? (vSeq.name + '#' + jSeq.name) : fields[`${type}lineage`],
            germLineSeq: glAlign.join(''),
            germLineRecombined: glRecomb.join('')
        }
    }
}
