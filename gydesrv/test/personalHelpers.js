export class MemoryCollection {
    rows = [];
    async createIndex() {}
    matches(row, query) { return Object.entries(query).every(([key, value]) => value?.$nin ? !value.$nin.includes(row[key]) : row[key] === value); }
    async findOne(query) { return structuredClone(this.rows.find(row => this.matches(row, query))); }
    async insertOne(row) {
        if (this.rows.some(old => old.credentialId === row.credentialId && old.requestKey === row.requestKey))
            throw Object.assign(Error('duplicate'), {code: 11000});
        this.rows.push(structuredClone(row));
    }
    async updateOne(query, update) {
        const row=this.rows.find(row => this.matches(row, query));
        if (row) Object.assign(row, structuredClone(update.$set));
        return {matchedCount:row ? 1 : 0};
    }
    find(query) {
        let rows = this.rows.filter(row => this.matches(row, query));
        const cursor = {sort() { rows.sort((a, b) => b.created - a.created); return cursor; },
            limit(n) { rows = rows.slice(0, n); return cursor; }, async toArray() { return structuredClone(rows); }};
        return cursor;
    }
}

export const config = {provider: 'tamarind', apiKey: 'test-only-key', credentialId: 'test-key-fingerprint',
    origin: 'https://app.tamarind.bio', maxBytes: 1024 * 1024};
export function fakeClient() {
    const jobs = new Map(), calls = [];
    return {jobs, calls,
        async upload(name) { calls.push(['upload', name]); return name; },
        async submit(name, type) { calls.push(['submit', name]); jobs.set(name, {JobName: name, Type: type, JobStatus: 'In Queue', User: 'test@example.test'}); },
        async job(name) { return jobs.get(name); },
        async cancel(name) { jobs.get(name).JobStatus = 'Stopped'; },
        async files(job) { return [`${job.User}/${job.JobName}/alignment.fasta`]; },
        async file() { return Buffer.from('>a\nACD\n>b\nAC-\n'); },
    };
}
export const mafft = () => ({fields: {}, files: {input: {bytes: Buffer.from('>a\nACD\n>b\nAC\n')}}});
