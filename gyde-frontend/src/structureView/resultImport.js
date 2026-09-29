export function canResumeResult(record) {
  return Boolean(record?._gyde_job_id && (
    record._gyde_analysis === 'pending' ||
    // Recover existing completed jobs whose earlier import was saved as an error.
    (record._gyde_analysis === 'error' && record._gyde_method_key === 'boltz2')
  ));
}

export async function importCompletedResult(result, {run, save, isActive, clearCompute = () => {}}) {
  const record = {
    _gyde_analysis: 'pending',
    _gyde_compute_complete: true,
    _gyde_job_id: result.id,
    _gyde_job_url: result['@url'],
    _gyde_method_key: result.methodKey,
    _gyde_job_name: result.jobName,
    _gyde_message: 'Prediction completed. Waiting to import results.',
  };
  if (!isActive()) return;
  clearCompute();
  save(record);
  try {
    await run();
  } catch (error) {
    if (!isActive()) return;
    save({
      ...record,
      _gyde_import_paused: true,
      _gyde_message: `Prediction completed. ${error.retryable ? 'Result retrieval is temporarily unavailable.' : 'Results could not be imported.'} Reopen this dataset to retry importing, or view the job in Tamarind. ${error.message || error}`,
    });
  }
}
