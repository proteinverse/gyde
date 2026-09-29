import {gunzipSync, strFromU8} from 'fflate';

import { arrayCmp, arrayCmpDeep} from '../utils/utils';

export function gapPatternsMatch(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; ++i) {
        if ((a[i] === '-') !== (b[i] === '-')) return false;
    }
    return true;
}

export function selectionCmp(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; ++i) {
        if (a[i] === b[i]) continue;
        if (!a[i] || !b[i]) return false;
        if (a[i].size !== b[i].size) return false;
        for (const x of a[i]) {
            if (!b[i].has(x)) return false;
        }
    }

    return true;
}

export function structureInfoEqual(a, b) {
    if (a.url !== b.url) return false;
    if (a.structureKey !== b.structureKey) return false;
    if (!arrayCmp(a.sequences, b.sequences)) return false;
    if (!arrayCmp(a.alignments, b.alignments)) return false;
    if (!arrayCmp(a.explicitChains, b.explicitChains)) return false;
    if (!arrayCmpDeep(a.explicitMappings, b.explicitMappings)) return false;
    if (a.modelIndex !== b.modelIndex) return false;
    if (!arrayCmp(a.ligands, b.ligands)) return false;
    if (!arrayCmp(a.dnas, b.dnas)) return false;
    if (!arrayCmp(a.rnas, b.rnas)) return false;

    return true
}

let blobIdSeed = 0;

export function structureDataKey(urlOrData) {
    if (!urlOrData) return;

    if (typeof urlOrData == 'string') {
        return urlOrData
    }

    if (urlOrData._gyde_url) return urlOrData._gyde_url;

    if (urlOrData instanceof Blob) {
        if (!urlOrData._gyde_structure_blobid) {
            urlOrData._gyde_structure_blobid = `blob${++blobIdSeed}`;
        }
        return urlOrData._gyde_structure_blobid
    }
}

export function extractSequences(i, seqColumns, seqRefColumns, columnarData) {
    const seqs = [];
    for (let si = 0; si < seqColumns.length; ++si) {
        seqs.push((seqColumns[si].data || [])[i]);
    }

    return seqs;
}

export function extractAlignmments(i, seqColumns, dsAlignments, dsReferences) {
    const seqs = [];
    for (let si = 0; si < seqColumns.length; ++si) {
        const seq = (dsAlignments[si] || [])[i];

        seqs.push(seq);
    }
    
    return seqs;
}

export function extractLigands(i, ligandColumns) {
    if (ligandColumns && ligandColumns.length > 0) {
        return ligandColumns.map((c) => c && c[i]).filter((x) => x);
    }
}

export function mimeToStructureType(type) {
    if (type === 'chemical/x-mdl-molfile') {
        return 'sdf';
    } else if (type === 'chemical/x-mmcif') {
        return 'mmcif';
    } else {
        return 'pdb'
    }
}

export function urlToStructureType(url) {
    if (typeof url !== 'string') return;
    const name = url.split('/').pop()?.split('?')[0]?.replace(/\.gz$/, '');
    if (name?.endsWith('.sdf')) return 'sdf';
    if (name?.endsWith('.cif') || name?.endsWith('.mmcif')) return 'mmcif';
}

export function decodeStructureBytes(bytes) {
    return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

export async function parseStructureData(structureData, progressCallback) {
    let structureText;
    let format = 'pdb';
    
    if (structureData instanceof Blob) {
        structureText = await structureData.text();
        format = mimeToStructureType(structureData.type);
        return {structureText, format};
    } 

    let url, mimeType = undefined, name;

    if (typeof(structureData) === "string") {
        url = structureData;
        const toks = url.split('/');
        name = toks[toks.length - 1];
    } else {
        url = structureData._gyde_url;
        mimeType = structureData._gyde_type;
        const toks = (url || '').split('/');
        name = toks[toks.length - 1];
    }

    const baseResponse = await fetch(url);
    if (!baseResponse.ok) {
        if (baseResponse.status === 500) {
            const body = await baseResponse.text();
            if (body.length > 5 && body.length < 100000) {
                throw Error('Could not fetch structure: ' + body.replace(/<[^>]+>/g, '').split('\n').filter((l) => l.length > 5)[0])
            }

        }
        throw Error('Could not fetch structure (HTTP ' + baseResponse.status + '). The file may be unavailable; retry the import or attach a structure.')
    }

    const contentLength = baseResponse.headers.get('content-length') && parseInt(baseResponse.headers.get('content-length'));
    let download = 0;

    const sendProgress = () => {
        if (!progressCallback) return;
        let msg = '' + download;
        if (contentLength) {
            msg = msg + '/' + contentLength;
        }
        if (name) {
            msg = `${name}: ${msg}`;
        }
        progressCallback(msg);
    }

    const transformer = new window.TransformStream({  // Our current babel stack doesn't seem to know about this (?!).
        start(constroller) {},
        async transform(chunk, controller) {
            chunk = await chunk;
            download += chunk.length;
            sendProgress();
            controller.enqueue(chunk);
        },
        flush(controller) {
            if (progressCallback) progressCallback();
        }
    });

    const response = new Response(baseResponse.body.pipeThrough(transformer), {headers: baseResponse.headers});

    if (name?.endsWith('.gz')) {
        const structureZipped = await response.arrayBuffer();
        const decompress = decodeStructureBytes(new Uint8Array(structureZipped));
        structureText = strFromU8(decompress);
        name = name.substring(0, name.length - 3);
    } else {
        structureText = await response.text();
    }

    if (mimeType) {
        format = mimeToStructureType(mimeType);
    } else if (name?.endsWith('.sdf')) {
        format = 'sdf';
    } else if (name?.endsWith('.cif') || name?.endsWith('.mmcif')) {
        format = 'mmcif';
    } else {
        format = 'pdb';
    }

    return {structureText: structureText, format: format};
}

function structureFetchUrl(structureData) {
    if (typeof(structureData) === "string") return structureData;
    return structureData?._gyde_url;
}

async function fetchStructureBlob(url, cache) {
    const response = await fetch(url, { cache });
    if (response.status === 304) {
        return { response, blob: new Blob() };
    }
    if (!response.ok) {
        if (response.status === 500) {
            const body = await response.text();
            if (body.length > 5 && body.length < 100000) {
                throw Error('Could not fetch structure: ' + body.replace(/<[^>]+>/g, '').split('\n').filter((l) => l.length > 5)[0])
            }
        }
        throw Error('Could not fetch structure: ' + (response.statusText || response.status));
    }
    return { response, blob: await response.blob() };
}

export async function getStructureBlob(structureData) {
    if (structureData instanceof Blob) {
        if (!structureData.size) {
            throw Error('Could not fetch structure: empty data');
        }
        return structureData;
    }

    const url = structureFetchUrl(structureData);
    if (!url) {
        throw Error('Could not fetch structure: missing URL');
    }

    let result = await fetchStructureBlob(url, 'reload');
    if (result.response.status === 304 || !result.blob.size) {
        result = await fetchStructureBlob(url, 'reload');
    }
    if (result.response.status === 304 || !result.blob.size) {
        throw Error('Could not fetch structure: empty response');
    }
    if (/\.gz(?:[?#]|$)/i.test(url)) {
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        // HTTP Content-Encoding may already have decompressed the response.
        const data = decodeStructureBytes(bytes);
        const type = {mmcif:'chemical/x-mmcif',sdf:'chemical/x-mdl-molfile'}[urlToStructureType(url)] || 'chemical/x-pdb';
        return new Blob([data], {type});
    }
    return result.blob;
}

export function structureDownloadFormat(structureInfo, structureBlob) {
    let format = mimeToStructureType(structureInfo?.type || structureBlob?.type);
    if (format === 'pdb') {
        format = urlToStructureType(structureInfo?.url) || format;
    }
    if (format === 'mmcif') format = 'cif';
    return format;
}

export function structureDownloadFilename(structureInfo, format, usedNames) {
    const parts = [
        structureInfo?.rowName,
        structureInfo?.structureKey,
        structureInfo?.structureLabel ?? structureInfo?.dataIndices?.[0]
    ].filter((p) => p !== undefined && p !== null && `${p}` !== '');
    const base = (parts.join('_') || 'structure').replace(/[/\\?%*:|"<>]/g, '_');
    const ext = format || 'pdb';
    let name = `${base}.${ext}`;
    let n = 2;
    while (usedNames && usedNames.has(name)) {
        name = `${base}_${n}.${ext}`;
        n += 1;
    }
    if (usedNames) usedNames.add(name);
    return name;
}
