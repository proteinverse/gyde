export function canStartAutomaticAlignment(props, hosting) {
  if (hosting && props._gyde_readonly) return false;
  if (hosting && !props.slivkaService?.service("mafft-7.475")) return false;
  const stale = Boolean(
    props.msaColumns?.some((mc) => mc && !props.columnarData[mc.column]),
  );
  return (
    props.seqColumns.length > 0 &&
    (!props.msaColumns || stale) &&
    !props.mafftPending &&
    !props.specialAlign &&
    props.alignmentKey !== "seqs" &&
    (!props.error || stale)
  );
}
