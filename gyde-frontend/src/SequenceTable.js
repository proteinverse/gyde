import React, {useMemo, useRef, useCallback, useImperativeHandle, forwardRef} from 'react';

import MSTable from './gmsa/MSTable';


const CONSTANT_EMPTY = [],
      CONSTAINT_OBJ = {};

function filterFunction(filterData) {
    const special = filterData?.special;
    if (special === 'null') {
        return (d) => (d === null || d === undefined || d === '');
    } else if (special === 'notnull') {
        return (d) => !(d === null || d === undefined || d === '');
    } else if (special) {
        throw Error('Bad special filter: ' + special);
    }
    const filterString = filterData;

    const filterList = [];
    for (const filterTerm of filterString.split(';')) {
        filterList.push(filterTermFunction(filterTerm.trim()));
    }

    if (filterList.length === 0) {
        return () => true;
    } else if (filterList.length === 1) {
        return filterList[0];
    } else {
        return (d) => filterList.every((f) => f(d))
    }
}

function filterTermFunction(term) {
    if (term[0] === '>') {
        const v = parseFloat(term.substring(1));
        return (d) => (d > v);
    } else if (term[0] === '<') {
        const v = parseFloat(term.substring(1));
        return (d) => {
            if (d === null || d === undefined || d === '') return false;
            return (d < v);
        }
    } else {
        const v = term.toLowerCase();
        return (d) => (d || '').toString().toLowerCase().indexOf(v) >= 0;
    }
}


export function applyTableFilters(data, dataRows, tableFilters, filter) {
    filter = new Set(filter || dataRows);

    for (const [col, filterData] of Object.entries(tableFilters)) {
        const colData = data[col];
        const ff = filterFunction(filterData);
        if (!colData) {
            // Generally, we can skip straight to empty set when filtering on an undefined column,
            // but need to consider "null" filters.
            if (!ff(undefined)) {
                filter = new Set();
            }
        } else {
            const nextFilter = new Set();
            
            colData.forEach((d, i) => {
                if (filter.has(i) && ff(d)) nextFilter.add(i);
            });
            filter = nextFilter;
        }

        if (!filter.size) break;
    }

    return filter
}

/**
 * Minimalist interface between GYDE and GMSA.  GMSA interface is still being
 * refined, so don't read too much into implementation details here...
 */
function SequenceTable(props, ref) {
    const {
        seqColumns = CONSTANT_EMPTY, alignments = CONSTANT_EMPTY, seqColumnNames = CONSTANT_EMPTY,
        alignmentFeatures = CONSTANT_EMPTY, references = CONSTANT_EMPTY, alternatives = CONSTANT_EMPTY,
        hcColumn, lcColumn, dataRows=CONSTANT_EMPTY, columnarData={}, dataColumns=[],
        selectionIds, updateSelection, colours={}, systemFont, systemFontScale, highlightCDRs, sortField,
        updateSortField, toggleSequenceAlternate, updateDatum, filter, selectedColumns = CONSTANT_EMPTY,
        columnFilter = CONSTANT_EMPTY, doColumnUnfilterRange, updateSelectedColumns, tableFilters,
        updateTableFilters, tableFormats, updateTableFormats, isSequenceLogoVisible, isHeatmapVisible,
        heatmapDataScale, heatmapRelativeToWT, heatmapColorPalette, heatmapDataObject, compact,
        cellWidth=12, cellHeight=20, cellPaddingX=2, cellPaddingY=2, columnTypes={}, columnDisplayNames={},
        reorderDataColumns, nameColumn='concept_name', refNameColumn='seed', colourBackground=false,
        setViewingJob, cancelSlivkaJob, selectedOtherColumns = CONSTAINT_OBJ, updateSelectedOtherColumns, bottomNav
    } = props;
    const dummyColumn = useMemo(() => dataRows.map((_) => undefined));
    const dataRowCount = dataRows.length;

    const filterST = useMemo(() => {
        return applyTableFilters(columnarData, dataRows, tableFilters || {}, filter);
    }, [columnarData, dataRows, filter, tableFilters]);

    const swizzle = useMemo(() => {
        let key = sortField, reverse=false;
        if (key && key[0] === '-') {
            key = key.substring(1);
            reverse = true;
        }
        if (key === refNameColumn) {
            return orderBySeedsColumnar(columnarData, reverse, filterST, nameColumn, refNameColumn);
        } else if (columnarData[key]) {
            return makeSortedTableSwizzlePrioritizingSeeds(columnarData[key], filterST, dataRows, reverse, nameColumn, refNameColumn, columnarData);
        }
    }, [columnarData, sortField, filterST, dataRows]);

    const secondaryStyles = useMemo(() => 
        alignmentFeatures.map((features, seqColumnIndex) => (seq, index) => {
            if (!highlightCDRs) return 'white';
            ++index;
            for (const cdr of features) {
                if (index >= cdr.start && index <= cdr.end) {
                    return cdr.color;
                }
            }
            const seqColumn = seqColumns[seqColumnIndex].column;
            if (seqColumn === lcColumn) return [250, 240, 217];
            if (seqColumn === hcColumn) return [191, 191, 223];
            return 'white';
        }),
        [alignmentFeatures, highlightCDRs, seqColumns, hcColumn, lcColumn]
    );

    const seqColumnTypes = useMemo(() => 
        seqColumns.map(({column}) => columnTypes[column] ?? 'protein'),
        [seqColumns, columnTypes]
    );

    const bgStyles = useMemo(() => 
        secondaryStyles.map((secondary, columnIndex) => (seq, index) => {
            if (!seq.seq) return 'white';

            if (seqColumnTypes[columnIndex] !== 'protein') return secondary(seq, index);

            if (colours === 'germline-invert') {
                if (seq.germLine && seq.germLine[index] !== seq.seq[index]) {
                    return 'black';
                }
            } else if (colourBackground) {
                return (colours[seq.seq[index]]?.trim()) || 'white';
            }
            return secondary(seq, index);
        }),
        [colours, secondaryStyles, colourBackground, seqColumnTypes]
    );

    const fgStyles = useMemo(() => 
        secondaryStyles.map((secondary, columnIndex) => (seq, index) => {
            if (!seq.seq) return 'black';
            if (seqColumnTypes[columnIndex] !== 'protein') return 'black';

            if (colours === 'germline') {
                if (seq.germLine && seq.germLine[index] !== seq.seq[index]) {
                    return 'red';
                } else {
                    return 'black';
                }
            } else if (colours === 'germline-invert') {
                if (seq.germLine && seq.germLine[index] !== seq.seq[index]) {
                    return secondary(seq, index);
                } else {
                    return 'black';
                }
            } else if (colourBackground) {
                return 'black';
            } else {
                return (colours[seq.seq[index]]?.trim()) || 'black';
            }
        }),
        [colours, secondaryStyles, colourBackground, seqColumnTypes]
    );

    const selection = useMemo(() => {
        return selectionIds ? Array.from(selectionIds) : []
    }, [selectionIds])


    const markers = alternatives.map(makeMarkerArray);

    const defineDataColumn = (col) => {
        let colData = columnarData[col] || dummyColumn;
        let bgColours = undefined;
        if (col === refNameColumn) {
            const seedColumn = columnarData[refNameColumn] || CONSTANT_EMPTY,
                  conceptNameColumn = columnarData[nameColumn] || CONSTANT_EMPTY;

            bgColours = dataRows.map((i) => seedColumn[i] && conceptNameColumn[i] && seedColumn[i].split && conceptNameColumn[i].split && conceptNameColumn[i].split('.')[0] === seedColumn[i].split('.')[0] ? '#ff8888' : '#ffffff');
        }


        let type = columnTypes[col] || 'info';
        if (type === 'structure') {
            colData = colData.map((s) => {
                if (s === undefined || s === null) return;

                const result = {};

                if (s?._gyde_analysis === 'pending') {
                    result.status = s._gyde_import_paused ? 'import_waiting' : false;
                    if (s?._gyde_message) {
                        result.message =  s?._gyde_message;
                    }
                } else if (s?._gyde_analysis === 'error') {
                    result.status = 'error';
                    result.message =  s?._gyde_message || 'Analysis failed';
                } else if (s) {
                    result.status=true;
                }

                const jurl = s?._gyde_job_url || s?._gyde_msa_job_url;
                if (jurl && setViewingJob) {
                    const toks = jurl.split('/');
                    result.onClick = () => {setViewingJob(toks[toks.length -1], jurl)};
                }

                const jid = s?._gyde_job_id || s?._gyde_msa_job_id;
                if (jid && cancelSlivkaJob && s?._gyde_analysis === 'pending' && !s._gyde_compute_complete) {
                    result.onCancel = () => {cancelSlivkaJob(jid)};
                }

                return result;

            });
            type = 'status';
        } else if (type === 'smiles') {
            type = 'selectable';
        }

        return {
            name: col,
            displayName: columnDisplayNames[col],
            key: col,
            type: type,
            data: colData,
            minWidth: type === 'structure' ? 25 : 50,
            preferredWidth: type='structure' ? 40: 150,
            bgColours,
            selected: selectedOtherColumns[col],
            updateSelected: updateSelectedOtherColumns?.bind(null, col),
            update: (index, value) => updateDatum(index, col, value)
        };
    }

    const stOnClicks = useMemo(() => {
        return seqColumns.map(({column}, index) => ((ev) => {
            const alts = (alternatives[index]||[])[ev.item] || [];
            for (const alt of alts) {
                if (alt.position === ev.column + 1) {
                    if (toggleSequenceAlternate) {
                        toggleSequenceAlternate(column, ev.item, alt)
                        return;
                    }
                }
            }

            if (updateSelection) {
                updateSelection({
                    op: (ev.ctrlKey || ev.metaKey) 
                        ? 'toggle'
                        : ev.shiftKey
                          ? 'extend'
                          : 'set', 
                    item: ev.item,
                    column: ev.column,
                    swizzle: ev.swizzle
                })
            }
        }));
    }, [alternatives, seqColumns, toggleSequenceAlternate, updateSelection]);

    const stOnMarkerClick = useMemo(() => {
        return seqColumns.map(({column}) => (({startDeletion, endDeletion}) => {
            if (doColumnUnfilterRange) {
                doColumnUnfilterRange(column, startDeletion, endDeletion);
            }
        }));
    }, [seqColumns, doColumnUnfilterRange]);

    const defineAlignmentColumn = (colName) => {
        const index = seqColumns.findIndex(({column}) => column === colName);
        const alignment = (alignments || [])[index] || [];
        const reference = references[index];
        const data = alignment.map((seq, seqIndex) => {
            const ar = {seq: seq || ''};
            if (reference && reference[seqIndex]) ar.germLine = reference[seqIndex];
            return ar;
        });

        return (
            {    
                key: seqColumns[index].column,
                name: seqColumnNames[index] || `Sequence ${index + 1}`,
                type: 'msa',
                data,
                features: alignmentFeatures[index],
                residueNumbers: alignment.residueNumbers,
                fgColour: fgStyles[index],
                bgColour: bgStyles[index],
                minWidth: 100,
                preferredWidth: 300,
                markers: markers[index],
                onClick: stOnClicks[index],
                selectedColumns: selectedColumns[index],
                updateSelectedColumns: updateSelectedColumns?.bind(null, seqColumns[index].column),
                columnFilter: columnFilter[index],
                onHiddenColumnMarkerClick: stOnMarkerClick[index]
            }
        )
    }

    const dataColumnDefs = useMemo(() => {
        const seqColumnKeys = new Set(seqColumns.map(({column}) => column));
        return (dataColumns || []).flatMap((c) => seqColumnKeys.has(c) ? [defineAlignmentColumn(c)] : [defineDataColumn(c)]);
    }, [columnarData, dataColumns, alignments, references, alignmentFeatures, selectedColumns, seqColumns, alternatives,
        stOnClicks, fgStyles, bgStyles, columnFilter, stOnMarkerClick, selectedOtherColumns]);

    const tableRef = useRef();
    useImperativeHandle(ref, () => ({
        scrollIntoView: (index) => tableRef.current.scrollIntoView(index)
    }), [tableRef]);

    if (alignments && alignments.some((ali) => ali && !ali.residueNumbers)) {
        console.log('rn', alignments)
        throw Error('Alignments must have explicit residue numbers.');
    }

    const columns = useMemo(() => ([
        ...dataColumnDefs
    ]), [bgStyles, fgStyles, colours, dataColumnDefs]);

    const columnDataRef = useRef({});
    columnDataRef.current.dataColumnDefs = dataColumnDefs;
    const checkColumnMove = useCallback((sourceIndex, destIndex) => {
        const {dataColumnDefs} = columnDataRef.current;


        if (reorderDataColumns) {
            const firstDataIndex = 0,
                  lastDataIndex = dataColumnDefs.length;

            if (sourceIndex >= firstDataIndex && sourceIndex < lastDataIndex && destIndex >= firstDataIndex && destIndex <= lastDataIndex) return true;
        }
        return false;
    }, [reorderDataColumns]);

    const doColumnMove = useCallback((sourceIndex, destIndex) => {
        const {dataColumnDefs} = columnDataRef.current;

        
        if (reorderDataColumns) {
            const firstDataIndex = 0,
                  lastDataIndex = dataColumnDefs.length;

            if (sourceIndex >= firstDataIndex && sourceIndex < lastDataIndex && destIndex >= firstDataIndex && destIndex <= lastDataIndex) { 
                reorderDataColumns(sourceIndex - firstDataIndex, destIndex - firstDataIndex);
            }
        }
    }, [reorderDataColumns]);

    return (
        <React.Fragment>
            <MSTable
                columns={columns}
                rows={dataRowCount}
                selection={selection}
                updateSelection={updateSelection}
                cellWidth={cellWidth}
                cellHeight={cellHeight}
                cellPaddingX={cellPaddingX}
                cellPaddingY={cellPaddingY}
                systemFont={systemFont}
                systemFontScale={systemFontScale}
                sortField={sortField}
                updateSortField={updateSortField}
                swizzle={swizzle}
                filter={filterST}
                tableFilters={tableFilters}
                updateTableFilters={updateTableFilters}
                tableFormats={tableFormats}
                updateTableFormats={updateTableFormats}
                ref={tableRef}
                isSequenceLogoVisible={isSequenceLogoVisible}
                isHeatmapVisible={isHeatmapVisible}
                heatmapDataScale={heatmapDataScale}
                heatmapRelativeToWT={heatmapRelativeToWT}
                heatmapColorPalette={heatmapColorPalette}
                heatmapDataObject={heatmapDataObject}
                maxHeight={props.maxHeight || (compact ? 300 : 500)}
                stagedMutations={props.stagedMutations}
                setStagedMutations={props.setStagedMutations}
                isVariantSelectionActive={props.isVariantSelectionActive}
                checkColumnMove={checkColumnMove}
                doColumnMove={doColumnMove}
            />
            <div style={{display: 'flex', flexDirection: 'row', paddingTop: bottomNav ? '5px' : 0, alignItems: 'center'}}>
                { bottomNav }
                <div style={{fontSize: 12, paddingLeft: bottomNav ? '5px' : 0}}>
                    {selection && selection.length > 0 ? `${selection.length}/${ dataRowCount } rows selected` : `${dataRowCount} rows`}
                    {filterST.size < dataRowCount ? ` [${dataRowCount - filterST.size} hidden due to filters]` : undefined}
                </div>
            </div>
        </React.Fragment>
    )
}


export function makeSortedTableSwizzlePrioritizingSeeds(columnData, filter, rows, reverse, nameColumn, refNameColumn, data) {
    let stringCount = 0,
        numCount = 0,
        emptyCount = 0;

    let seedness = [];
    if (data[nameColumn] && data[refNameColumn]) {
        seedness = data[refNameColumn].map((s, i) => s === data[nameColumn][i] ? 1 : 0);
    }

    for (const d of columnData) {
        if (d === undefined || d === null || d === '') {
            ++emptyCount;
            continue;
        }
        const t = typeof(d);
        if (t === 'string') ++stringCount;
        if (t === 'number') ++numCount;
    }

    const sortAsText = (stringCount > 0);

    const sortData = rows.map((v, idx) => {return {v: columnData[idx], idx: idx, seedness: seedness[idx] || 0}});
    sortData.sort((a, b) => {
        let d;
        if (sortAsText) {
            const av = typeof(a.v) === 'string' ? a.v : (''+a.v),
                  bv = typeof(b.v) === 'string' ? b.v : (''+b.v);
            d = av.localeCompare(bv);
        } else {
            d = parseFloat(a.v||0) - parseFloat(b.v||0);
        }
        if (!d) d=a.seedness-b.seedness;
        if (!d) d=a.idx-b.idx;
        if (reverse) d=-d;
        return d;
    })

    let s = sortData.map(({idx}) => idx);
    if (filter) {
        s = s.filter((s) => filter.has(s));
    }
    return s;
}

export function orderBySeedsColumnar(data, reverse, filter, nameColumn, refNameColumn) {
    if (!data) {
        return;
    }

    if (!data[nameColumn] || !data[refNameColumn]) return;
    const length = Math.max(data[nameColumn].length, data[refNameColumn].length);

    const indexedData = []
    for (let i = 0; i < length; ++i) {
        indexedData.push({
            _strippedName: (data[nameColumn][i] || '').split('.')[0],
            seed: data[refNameColumn][i],
            _obsIndex: i
        });
    }

    const dataBySeed = {};
    for (const d of indexedData) {
        if (!dataBySeed[d.seed]) dataBySeed[d.seed] = [];
        dataBySeed[d.seed].push(d);
    }

    const seeds = [...Object.keys(dataBySeed)];
    seeds.sort();
    if (reverse) seeds.reverse();

    const swizzle = [];
    for (const seedId of seeds) {
        const group = dataBySeed[seedId];

        let includeGroup = true;
        if (filter) {
            includeGroup = false;
            for (const {_obsIndex: i} of group) {
                if (filter.has(i)) includeGroup = true;
            }
        }
        if (!includeGroup) continue;

        let seedIndex = group.findIndex((d) => d._strippedName === seedId);
        if (seedIndex >= 0) {
            const [seed] = group.splice(seedIndex, 1);
            if (!filter || filter.has(seed._obsIndex)) {
                swizzle.push(seed._obsIndex);
            }
        }

        for (const {_obsIndex: i} of group) {
            if (!filter || filter.has(i)) {
                swizzle.push(i);
            }
        }
        swizzle.push(-1);
    }

    return swizzle;
}

function makeMarkerArray(alignment) {
    if (!alignment) return [];
    const markers = [];
    alignment.forEach((seq, row) => {
        for (const {position: column} of seq || []) {
            markers.push({row, column: column - 1});
        }
    });
    return markers;
}

export default forwardRef(SequenceTable);
