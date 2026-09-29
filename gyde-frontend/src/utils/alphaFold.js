// Resolve the release-specific file URL from AlphaFold, rather than guessing a version.
export async function alphaFoldPdbUrl(accession, request = fetch) {
    const response = await request(`https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(accession)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`AlphaFold lookup failed (HTTP ${response.status}).`);
    const data = await response.json();
    const entries = Array.isArray(data) ? data : [data];
    const models = entries.filter(entry => entry?.uniprotAccession === accession);
    // A multi-fragment protein must not silently be represented by just its first fragment.
    if (models.length !== 1 || !models[0].pdbUrl) return null;
    const url = new URL(models[0].pdbUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'alphafold.ebi.ac.uk' ||
        url.port || url.username || url.password || !url.pathname.startsWith('/files/') ||
        !url.pathname.endsWith('.pdb')) throw new Error('AlphaFold returned an unsupported structure URL.');
    return url.href;
}

export async function mapUniProtEntry(entry, request = fetch) {
    const otherData = { primary_accession: entry.primaryAccession };
    try {
        const url = await alphaFoldPdbUrl(entry.primaryAccession, request);
        if (url) otherData.structure_url = url;
        else otherData.structure_status = 'No single AlphaFold PDB model available. Attach a PDB structure to run structure-based tools.';
    } catch {
        otherData.structure_status = 'AlphaFold lookup unavailable. Retry the import or attach a PDB structure.';
    }
    return { sequence: entry.sequence?.value, otherData };
}
