// Zero or one sequence needs no remote alignment job. Return null when MAFFT
// must align multiple sequences; preserve the input records for row matching.
export function trivialAlignment(sequences) {
    if (!sequences.length) return [];
    if (sequences.length !== 1) return null;
    const sequence = sequences[0];
    const seq = sequence.seq.replace(/[-.]/g, '');
    const alignment = [{...sequence, seq}];
    alignment.residueNumbers = Array.from(seq, (_, i) => String(i + 1));
    return alignment;
}
