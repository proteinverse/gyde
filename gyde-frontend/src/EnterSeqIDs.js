import {mapUniProtEntry} from "./utils/alphaFold";
import React, {useState, useReducer, useCallback, useRef, useMemo, useEffect} from 'react'

import { TextField, Button, ButtonGroup, Grid, FormControlLabel, FormControl, InputLabel, MenuItem, Select, Checkbox } from '@mui/material';
import {createTheme, ThemeProvider, styled} from '@mui/material/styles';

import {SmilesParser} from 'openchemlib/minimal';

import {usePeriodicUpdates} from './utils/hooks';
import {usePinger} from './Pinger';

const theme = createTheme({
    palette: {
        mode: 'dark'
    }
});


// Default menu styling involves fractional-alpha and looks awful with our colour scheme.
// So let's do hover and selected effects "manually" for now.
const menuItemStyle = {
    backgroundColor: '#153452',
    '&:hover': {backgroundColor: '#457482'},
    '&.Mui-selected': {
        backgroundColor: '#254462',
        opacity: 1.0,
        '&:hover': {backgroundColor: '#457482'}
    },
    '&.Mui-disabled': {
        backgroundColor: '#254462',
        opacity: 1.0
    }
};

function fetchUniprotAccessions(ids, update) {
    ids.forEach(async (id) => {
        const url = `https://rest.uniprot.org/uniprotkb/search?query=accession:${id}+OR+sec_acc:${id}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            update(id, {state: 'error'})
        } else {
            const data = await resp.json(); 
            for (const r of data.results) {
                if (r.sequence?.value) {
                    update(id, await mapUniProtEntry(r));
                    return;
                }
            }
            update(id, {state: 'error', error: 'not found'})
        }
    });
}

function fetchUniprotEntryNames(ids, update) {
    ids.forEach(async (id) => {
        const url = `https://rest.uniprot.org/uniprotkb/search?query=${id}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            update(id, {state: 'error'})
        } else {
            const data = await resp.json(); 
            for (const r of data.results) {
                if (r.uniProtkbId === id && r.sequence?.value) {
                    update(id, await mapUniProtEntry(r));
                    return;
                }
            }
            update(id, {state: 'error', error: 'Not found'})
        }
    });
}


const PDB_QUERY = `
    query($ids: [String!]!){
      entries(entry_ids: $ids) {
        struct {
          title
        }
        citation{
          rcsb_authors
        }
        audit_author {
          name
        }
        refine {
          ls_R_factor_R_free
          ls_R_factor_R_work
        }
        pubmed {
          rcsb_id
          rcsb_pubmed_central_id
        }
        exptl {
          method
        }
        rcsb_entry_info {
          resolution_combined
        }
        pdbx_audit_revision_history {
          major_revision
          minor_revision
          revision_date
        }
        polymer_entities {
          entity_src_gen {
            pdbx_gene_src_gene
            pdbx_gene_src_ncbi_taxonomy_id
          }
          entity_src_nat {
            pdbx_ncbi_taxonomy_id
          }
          entity_poly {
            pdbx_strand_id,
            pdbx_seq_one_letter_code
          }
          uniprots {
            rcsb_id
          }
        }
        entry {
          id
        }
      }
    }`;


async function fetchPdbChains(ids, update) {
    const chainsByStructure = {};
    const canonicalIdToQueryId = {};
    for (const id of ids) {
        const match = /^(\d\w{3}):(\w+)$/.exec(id);
        if (match) {
            const sid = match[1].toUpperCase(), chain = match[2];
            if(!chainsByStructure[sid]) chainsByStructure[sid] = new Set();
            chainsByStructure[sid].add(chain);
            canonicalIdToQueryId[`${sid}:${chain}`] = id;
        } else {
            update(id, {state: 'error', error: 'Does not match <pdb_id>:chain>'});
        }
    }

    const sids = Object.keys(chainsByStructure);
    try {
        if (sids.length > 0) {
            const resp = await fetch('https://data.rcsb.org/graphql', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({query: PDB_QUERY, variables: {ids: sids}})
            });
            if (!resp.ok) {
                throw Error(`Query failed: ${resp.statusText}`);
            }
            const data = await resp.json();
            for (const ent of data.data?.entries) {
                const id = ent.entry?.id;
                const wantedChains = chainsByStructure[id];
                if (!wantedChains) continue;

                const title = ent.struct?.title || '';

                const history = [...ent.pdbx_audit_revision_history]
                history.sort((a, b) => {
                    return a.major_revision - b.major_revision || a.minor_revision - b.minor_revision;
                });
                const latest = history[history.length - 1]
                const latestVersion = `v${latest.major_revision}-${latest.minor_revision}`;
                const longId = 'pdb_0000' + id.toLowerCase();
                const versionURI = `https://files-versioned.rcsb.org/pdb_versioned/data/entries/${id.substring(1, 3).toLowerCase()}/${longId}/${longId}_xyz_${latestVersion}.cif.gz`;

                for (const poly of ent.polymer_entities) {
                    if (poly.entity_poly && poly.entity_poly.pdbx_strand_id) {
                        for (const chain of poly.entity_poly.pdbx_strand_id.split(',')) {
                            if (wantedChains.has(chain)) {
                                const cid = `${id.toUpperCase()}:${chain}`,
                                      sid = canonicalIdToQueryId[cid];

                                update(sid, {
                                    sequence: poly.entity_poly.pdbx_seq_one_letter_code || '',
                                    otherData: {
                                        title,
                                        version: latestVersion,
                                        structure_url: versionURI
                                    }
                                })

                                delete canonicalIdToQueryId[cid];
                            }
                        }
                    }
                }
            }
            for (const id of Object.values(canonicalIdToQueryId)) {
                update(id, {state: 'error', error: 'Chain not found'});
            }
        }
    } catch (err) {
        console.log(err);
        for (const id of Object.values(canonicalIdToQueryId)) {
            update(id, {state: 'error', error: 'Query failed'});
        }
    }
}

const BASE_ID_TYPES = [
    {
        label: 'UniProt accessions',
        fetcher: fetchUniprotAccessions,
    },
    {
        label: 'Uniprot entry names',
        fetcher: fetchUniprotEntryNames
    },
    {
        label: 'PDB (id:chain)',
        fetcher: fetchPdbChains
    }
];

const CONSTANT_OBJ = {};

export default function EnterSeqIDs({onDataLoad, idTypes: extraIdTypes=[]}) {
    const now = Date.now();

    const idTypes = useMemo(() => [...BASE_ID_TYPES, ...extraIdTypes], [BASE_ID_TYPES, extraIdTypes])

    const [aliType, setAliType] = useState('seqs');
    const [idType, setIdType] = useState(idTypes[0].label);

    const [ids, setIDs] = useState([]);
    const filteredIDs = useMemo(() => ids.filter((x) => x.length > 0), [ids]);

    const handleChange = useCallback((ev) => {
        setIDs(ev.target.value.split(/[\s,;]+/));
    }, []);


    const [seqCaches, updateSeqCache] = useReducer(
        (seqCaches, {idType, id, value}) => ({...seqCaches, [idType]: {...(seqCaches[idType] || CONSTANT_OBJ), [id]: value}}),
        {}
    );
    const seqCache = seqCaches[idType] || CONSTANT_OBJ;
    const fetcher = idTypes.filter((i) => i.label === idType)[0]?.fetcher;
    const idTimerRef = useRef({});
    const idTimer = idTimerRef.current;

    const toFetch = useMemo(() => {
        return filteredIDs.filter((i) => !seqCache[i]);
    }, [filteredIDs, seqCache]);

    const tick = usePeriodicUpdates(toFetch.length > 0 ? 1000 : 10000);

    const toFetchNow = useMemo(() => {
        const toFetchNow = [], newTimer = {};
        for (const f of toFetch) {
            if (!idTimer[f]) {
                newTimer[f] = now + 900;
            } else {
                if (idTimer[f] <= now) {
                    toFetchNow.push(f);
                }
                newTimer[f] = idTimer[f];
            }
            idTimerRef.current = newTimer;
        }
        return toFetchNow;
    }, [toFetch, tick]);

    useEffect(() => {
        if (toFetchNow.length > 0) {
            for (const f of toFetchNow) {
                updateSeqCache({idType, id: f, value: {state: 'fetching'}})
            }
            fetcher(toFetchNow, (id, value) => updateSeqCache({idType, id, value}));
        }
    }, [idType, fetcher, toFetchNow]);

    const status = useMemo(() => {
        return ids.map((i) => {
            const res = seqCache[i];
            if (!res) {
                return [' '];
            } else if (res.state === 'fetching') {
                return ['↻'];
            } else if (res.state === 'error') {
                return ['❌', res.error];
            } else {
                return ['✓'];
            }
        });
    }, [ids, seqCache]);

    const handleSubmit = useCallback((ev) => {
        const ids = [];
        const seqs = [];
        const otherColumns = {};
        const dataColumns =  ['accession', 'sequence'];

        for (const i of filteredIDs) {
            const r = seqCache[i];
            if (r && r.sequence) {
                const index = ids.length;

                ids.push(i);
                seqs.push(r.sequence)

                if (r.otherData) {
                    for (const [k, v] of Object.entries(r.otherData)) {
                        if (!otherColumns[k]) {
                            otherColumns[k] = [];
                            dataColumns.push(k);
                        }
                        otherColumns[k][index] = v;
                    }
                }
            }
        }

        const columnarData = {
            ...otherColumns,
            accession: ids,
            sequence: seqs
        };

        const msaTableColumns = ['Names'];
        if (columnarData.primary_accession) {
            msaTableColumns.push('primary_accession');
        }
        msaTableColumns.push('sequence');

        const dataset = {
            name: 'UniProt proteins',
            columnarData,
            isAntibody: false,
            dataColumns,
            seqColumns: [{column: 'sequence'}],
            seqColumnNames: ['Sequence'],
            alignmentKey: aliType,
            nameColumn: 'accession',
            msaTableColumns
        };

        onDataLoad(undefined, dataset);
    }, [onDataLoad, filteredIDs, seqCache, aliType]);

    const numFetching = filteredIDs.filter((i) => seqCache[i]?.state === 'fetching').length,
          numErrors = filteredIDs.filter((i) => seqCache[i]?.state === 'error').length;

    return (
        <ThemeProvider theme={theme}>
          <Grid container
                style={{maxWidth: 800, marginLeft: 'auto', marginRight: 'auto', marginBottom: '2rem'}}>
              
              <Grid item xs={3}>
                  <FormControl>
                      <InputLabel id="idtype">Identifier type</InputLabel>
                      <Select labelId="idtype-label"
                              id="idtype"
                              value={idType}
                              label="Identifier type"
                              onChange={(ev) => setIdType(ev.target.value)} >
                          { idTypes.map(({label}) => (
                                <MenuItem key={label} sx={menuItemStyle} value={label}>{label}</MenuItem>
                          )) }
                      </Select>
                  </FormControl>
              </Grid>

              <Grid item xs={3}>
                  <FormControl>
                      <InputLabel id="dstype-label">Alignment:</InputLabel>
                      <Select labelId="dstype-label"
                              id="dstype"
                              value={aliType}
                              label="Alignment"
                              onChange={(ev) => setAliType(ev.target.value)} >
                          <MenuItem sx={menuItemStyle} value="seqs">No-alignment</MenuItem>
                          <MenuItem sx={menuItemStyle} value="alignedSeqs">Align sequences</MenuItem>
                      </Select>
                  </FormControl>
              </Grid>

              <Grid item xs={12} sx={{paddingTop: '2rem', paddingBottom: '2rem', display: 'flex', flexDirection: 'row' /* , justifyContent: 'center' */}}>
                  <div style={{paddingTop: '1.4em'}}>
                      { status.map(([s, tt], i) => (
                        <div title={tt} key={i} style={{height: '1.5334em', paddingRight: '0.5em'}}>{s}</div>
                      )) }
                  </div>
                  <TextField id="abps"
                             label="Enter IDs..."
                             variant="outlined"
                             multiline
                             maxRows={Infinity}
                             value={ids.join('\n')}
                             onChange={handleChange} 
                             style={{width: '30rem', color: 'white', lineHeight: '1.6rem'}} />
              </Grid>

              <Grid item xs={12}>
                  <Button variant="contained" 
                          color="primary" 
                          onClick={handleSubmit}
                          disabled={filteredIDs.length <= numErrors || toFetch.length > 0 || numFetching > 0}>
                    Create dataset {numErrors && (numErrors < filteredIDs.length) ? ' (skipping errors)' : undefined}
                  </Button>  
              </Grid>
              <Grid item xs={12}>
                  { numFetching ? `Fetching: ${numFetching}.` : undefined }
                  { numErrors ? `Errors: ${numErrors}.` : undefined}
              </Grid>
          </Grid>
        </ThemeProvider>
    )
}