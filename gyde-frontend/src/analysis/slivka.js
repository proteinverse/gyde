
export default function slivka(slivkaService, serviceName, formData, wantedFiles=[], options={}) {
    if (typeof(options) === 'boolean') {
        options = {useCache: options};
    }
    const {statusCallback, pollInterval=5000} = options;

    return new Promise((resolve, reject) => {
        slivkaService.submit(serviceName, formData, options, (status) => {
            if (statusCallback) {
                statusCallback(status?.status);
            }

            if (status?.status === 'COMPLETED') {
                resolve(slivkaService.fetch(status['id'], wantedFiles));
            } else if (status?.finished) {
                reject(`Job did not complete, status=${status?.status || 'UNKNOWN'}`);
            }
        }).catch(reject);
    });

}
