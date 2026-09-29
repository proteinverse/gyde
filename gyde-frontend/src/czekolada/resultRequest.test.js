import {resultRequest, retryDelay} from './resultRequest';
const response = (status, value, retryAfter) => ({ok: status === 200, status,
  headers: {get: () => retryAfter}, json: async () => value});
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); delete global.fetch; });
test('retries 429 using Retry-After without resubmitting', async () => {
  fetch.mockResolvedValueOnce(response(429, {error:'busy'}, '5')).mockResolvedValueOnce(response(200, {files:['model']}));
  const pending = resultRequest('/api/jobs/id/files');
  await flush(); jest.advanceTimersByTime(4999); await flush(); expect(fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1); await flush();
  await expect(pending).resolves.toEqual({files:['model']});
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/jobs/id/files', '/api/jobs/id/files']);
  expect(fetch.mock.calls.every(call => !call[1].method)).toBe(true);
});
test('retries network and interrupted body failures', async () => {
  fetch.mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce({...response(200), json: async () => {throw new TypeError('body interrupted');}})
    .mockResolvedValueOnce(response(200, 'ok'));
  const pending = resultRequest('/media/job/0');
  await flush(); jest.advanceTimersByTime(1000); await flush(); jest.advanceTimersByTime(2000); await flush();
  await expect(pending).resolves.toBe('ok');
});
test.each([400,401,403,404,422])('does not retry definitive HTTP %s errors', async status => {
  fetch.mockResolvedValue(response(status, {error:'denied'}));
  await expect(resultRequest('/media/job/0')).rejects.toMatchObject({retryable:false});
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('bounds attempts during a prolonged outage', async () => {
  fetch.mockResolvedValue(response(503, {error:'unavailable'}));
  const pending = resultRequest('/media/job/0').catch(error => error);
  for (let i = 0; i < 6; i++) { await flush(); jest.runOnlyPendingTimers(); }
  expect(await pending).toMatchObject({retryable:true}); expect(fetch).toHaveBeenCalledTimes(6);
});
test('limits concurrent downloads including body reads to three', async () => {
  const finish = [];
  fetch.mockImplementation(async () => ({ok:true, json: () => new Promise(resolve => finish.push(resolve))}));
  const pending = Promise.all(Array.from({length:8}, (_, i) => resultRequest(`/media/${i}`)));
  await flush(); expect(fetch).toHaveBeenCalledTimes(3);
  finish.splice(0).forEach(resolve => resolve('ok')); await flush(); expect(fetch).toHaveBeenCalledTimes(6);
  finish.splice(0).forEach(resolve => resolve('ok')); await flush(); expect(fetch).toHaveBeenCalledTimes(8);
  finish.splice(0).forEach(resolve => resolve('ok')); await expect(pending).resolves.toHaveLength(8);
});
test('supports HTTP dates and invalid Retry-After fallback', () => {
  expect(retryDelay({headers:{get:()=> 'Tue, 15 Sep 2026 20:00:10 GMT'}}, 0, Date.parse('2026-09-15T20:00:00Z'))).toBe(10000);
  expect(retryDelay({headers:{get:()=> 'invalid'}}, 2)).toBe(4000);
});

test('timeouts release the download slot and retry the read', async () => {
  fetch.mockImplementationOnce((_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(Error('timeout'), {name:'AbortError'})));
  })).mockResolvedValueOnce(response(200, 'ok'));
  const pending = resultRequest('/media/job/0');
  await flush(); jest.advanceTimersByTime(30000); await flush();
  jest.advanceTimersByTime(1000); await flush();
  await expect(pending).resolves.toBe('ok');
});
