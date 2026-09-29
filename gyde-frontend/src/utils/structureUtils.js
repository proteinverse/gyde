export function getLetterToSequenceNumber(structure_chains) {
    const letterToSequenceIndexMap = new Map();

    structure_chains.forEach((entryString, index) => {
        const chainList = entryString.split(',');
        for (const letter of chainList) {
            letterToSequenceIndexMap.set(letter, index);
        }
    });

    return letterToSequenceIndexMap;
}

export function getMolstarChainIndexToSequenceIndex(chains, chainIndexToEntityIndex, entityTypes) {
    const result = new Map();
    let sequenceIndex = 0;

    chains.forEach((chain, chainIndex) => {
        const entityType = entityTypes[chainIndexToEntityIndex[chainIndex]];
        
        if (entityType.includes('polypeptide')) {
            result.set(chainIndex, sequenceIndex);
            sequenceIndex += 1;
        } else {
            result.set(chainIndex, null);
        }
    })

    return result;
}

/// gapArray:                                                   [0, 1, 1, 0, 0, 1, 1, 1, 0]
/// creates an internal gap-length map that looks like this:    [0, 2, 2, 0, 0, 3, 3, 3, 0]
/// returns a cumulative sum of that map:                       [0, 2, 2, 2, 2, 5, 5, 5, 5]
export function precomputeGaps(gapArray) {
    const len = gapArray.length;
    let sum = 0;
    const gapMap = [];

    for (let i = 0; i < len; i++) {
        gapMap.push(0);

        if (gapArray[i] === 1) {
            sum += 1;
        }
        if (gapArray[i] === 0 || i === len - 1) {
            let s;
            (gapArray[i] === 0) ? s = 1 : s = 0;

            for (let j = 0; j < sum; j++) {
                gapMap[i - j - s] += sum;
            }
            sum = 0;
        }
    }

    const result = [];
    let cumulativeSum = 0;
    let lastValue = 0;

    for (let i = 0; i < len; i++) {
        const val = gapMap[i];

        if (val !== lastValue) {
            cumulativeSum += val;
            lastValue = val;
        }

        result.push(cumulativeSum);
    }

    return result;
}




export async function makeMappingsGeneric(gydeWorkerService, seqByChain, residueInfoByChain, sequences, chains) {
    const chainBySeq = {};
    for (const [chain, seq] of Object.entries(seqByChain)) {
        if (!chainBySeq[seq]) chainBySeq[seq] = [];
        chainBySeq[seq].push(chain);
    }

    if (chains) {
        const residueMappings = sequences.map((_) => undefined);
        const mappingsByChain = sequences.map(() => ({}));
        await Promise.all(
            sequences.map(async (rs, rsi) => {
                if (chains[rsi]) {
                    for (const chain of chains[rsi].split(',')) {
                        const seq = seqByChain[chain];
                        if (seq) {
                            let ali;
                            if (seq === rs) {
                                ali = {
                                    score: rs.length * 100,
                                    aliA: seq,
                                    aliB: rs
                                };
                            } else {
                                ali = await gydeWorkerService.align(seq, rs);
                            }

                            const residues = residueInfoByChain[chain] || [];
                            const mapping = alignmentToMapping(ali, residues);
                            mappingsByChain[rsi][chain] = mapping;
                            if (chain === chains[rsi].split(',')[0]) residueMappings[rsi] = mapping;
                        }
                    }
                }
            })
        );

        return {
            chains,
            mappings: residueMappings,
            mappingsByChain
        }
    } else {
        const chainMappingAlignments = sequences.map((_) => []);
        await Promise.all(
            Object.entries(chainBySeq).map(async ([ss, chains]) => {
                let bestAli = {score: -1000}, bestIndex = null;

                sequences.forEach((rs, rsi) => {
                    if (rs === ss) {
                        if (bestIndex === null) {
                            bestAli = {
                                score: rs.length * 100,
                                aliA: ss,
                                aliB: rs
                            };
                            bestIndex = rsi;
                        }
                    }
                });

                if (bestIndex === null) {
                    await Promise.all(
                        sequences.map(async (rs, rsi) => {
                            const ali = await gydeWorkerService.align(ss, rs);
                            if (ali.score > bestAli.score || (ali.score === bestAli.score && rsi < bestIndex)) {
                                bestAli = ali;
                                bestIndex = rsi;
                            }
                        })
                    );
                } 

                if (bestAli.aliA) {
                    for (const auth of chains || []) {
                        const mapping = alignmentToMapping(bestAli, residueInfoByChain[auth] || []);
                        chainMappingAlignments[bestIndex].push({chain: auth, alignment: bestAli, mapping});
                    }
                }
            })

        );

        chainMappingAlignments.forEach((ml) => ml.sort((a, b) => b.alignment.score - a.alignment.score));
        const chainMapping = chainMappingAlignments.map((ml) => {
            if (ml.length) {
                const topAli = ml[0].alignment;
                const chains = [];
                for (let i = 0; i < ml.length; ++i) {
                    if (ml[i].alignment.aliA === topAli.aliA && ml[i].alignment.aliB === topAli.aliB) {
                        chains.push(ml[i].chain);
                    } else {
                        break;
                    }
                }
                return chains;
            } else {
                return [];
            }
        });

        const residueMappings = chainMappingAlignments.map((ml) => (ml.length ? ml[0].mapping : undefined));
        return {
            chains: chainMapping.map((m) => m.length > 0 ? m.join(',') : undefined),
            mappings: residueMappings,
            mappingsByChain: chainMappingAlignments.map((ml, i) => Object.fromEntries(
                ml.filter(entry => chainMapping[i].includes(entry.chain)).map(entry => [entry.chain, entry.mapping])
            ))
        }
    }
}


function alignmentToMapping(bestAli, residues) {
    let residueCursor = 0;

    let index = 0;
    let matches = 0;
    let gaps = 0;

    const mapping = [];
    for (let i = 0; i < bestAli.aliA.length; ++i) {
        if (bestAli.aliB[i] !== '-') {
            let res = undefined;
            if (bestAli.aliA[i] !== '-') {
                res = residues[residueCursor] /*.value*/;
            }
            mapping.push({
                value: res // {...res}
            });

            ++index;
            if (bestAli.aliB[i] === bestAli.aliA[i]) {
                ++matches;
            } else if (bestAli.aliA[i] === '-') {
                ++gaps;
            }
        } 
        if (bestAli.aliA[i] !== '-') {
            ++residueCursor;
        } 
    }

    mapping.perc_identity = (100.0 * matches) / (index-gaps);
    mapping.perc_coverage = (100.0 * (index - gaps)) / index;

    return mapping;
}