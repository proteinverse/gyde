import {canResumeResult, importCompletedResult} from './resultImport';
const result = {id:'existing-job', '@url':'/api/jobs/existing-job', methodKey:'boltz2', jobName:'boltz2'};
test('preserves completed job identity before loading results', async () => {
  const save = jest.fn();
  const run = jest.fn(async () => {
    expect(save).toHaveBeenCalledWith(expect.objectContaining({_gyde_compute_complete:true, _gyde_job_id:'existing-job', _gyde_analysis:'pending'}));
  });
  await importCompletedResult(result, {save,run,isActive:()=>true});
  expect(run).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
});
test.each([true,false])('preserves resumable completed jobs after an import error, retryable=%s', async retryable => {
  const save = jest.fn();
  await importCompletedResult(result, {save, isActive:()=>true, run:async () => {throw Object.assign(Error('problem'), {retryable});}});
  const record = save.mock.calls[1][0];
  expect(record).toMatchObject({_gyde_analysis:'pending',_gyde_import_paused:true,_gyde_compute_complete:true});
  expect(record._gyde_message).toContain('Prediction completed'); expect(canResumeResult(record)).toBe(true);
});
test('does not change an old workspace after navigation', async () => {
  let active = true; const save = jest.fn();
  await importCompletedResult(result, {save,isActive:()=>active, run:async () => {active=false;throw Error('network');}});
  expect(save).toHaveBeenCalledTimes(1);
});
test('recovers previous Boltz import failures but ignores successful structures and missing job IDs', () => {
  expect(canResumeResult({_gyde_analysis:'error', _gyde_method_key:'boltz2', _gyde_job_id:'original'})).toBe(true);
  expect(canResumeResult({_gyde_analysis:'success', _gyde_job_id:'original'})).toBe(false);
  expect(canResumeResult({_gyde_analysis:'error', _gyde_method_key:'boltz2'})).toBe(false);
});

test('clears cancellable compute state before a slow import and leaves it cleared on failure', async () => {
  let cancellable = true;
  let fail;
  const clearCompute = jest.fn(() => {cancellable=false;});
  const pending = importCompletedResult(result, {
    clearCompute, save:jest.fn(), isActive:()=>true,
    run:() => {
      expect(cancellable).toBe(false);
      return new Promise((_resolve, reject) => {fail=reject;});
    },
  });
  expect(clearCompute).toHaveBeenCalledTimes(1);
  expect(cancellable).toBe(false);
  fail(Error('temporary outage'));
  await pending;
  expect(cancellable).toBe(false);
});
