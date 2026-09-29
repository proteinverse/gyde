import React, {useEffect, useState} from 'react';
import {Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography} from '@mui/material';
import {computeRequest} from '../../compute';

// This consent covers GYDE's automatic alignments as well as explicit tool runs.
// It is never authorization: the API key's account controls remain authoritative.
export default function PersonalCompute({children}) {
    const [accepted, setAccepted] = useState(false), [open, setOpen] = useState(false);
    const [jobs, setJobs] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const refresh = async () => {
        setBusy(true); setError('');
        try {
            const listing = await computeRequest('/compute/tamarind/jobs');
            const rows = [];
            for (let i = 0; i < listing.jobs.length; i += 4) {
                rows.push(...await Promise.all(listing.jobs.slice(i, i + 4).map(async job => {
                    if (job.finished) return job;
                    try { return await computeRequest(job['@url']); }
                    catch { return {...job, message: 'Could not refresh this job. Try again shortly.'}; }
                })));
            }
            setJobs(rows);
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    useEffect(() => { if (open) refresh(); }, [open]); // Refresh is explicitly user initiated, not a second poller.
    const action = async fn => {
        setBusy(true); setError('');
        try { await fn(); await refresh(); } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const download = async job => {
        const result = await computeRequest(`${job['@url']}/files`);
        setJobs(rows => rows.map(row => row.id === job.id ? {...row, files: result.files} : row));
    };
    return <>
        {!accepted ? <Dialog open maxWidth="sm" fullWidth>
            <DialogTitle>This GYDE installation uses Tamarind compute</DialogTitle>
            <DialogContent><Typography>
                Analyses upload their required sequences and structures to Tamarind and use the account whose API key is configured on this computer.
                Tamarind permissions, limits and charges apply. GYDE may also run MAFFT automatically when you import or edit an unaligned dataset.
                Your datasets remain in this installation’s database.
            </Typography><Typography sx={{mt:2}}>Use this installation only on your own computer. Your API key is kept on the backend.</Typography></DialogContent>
            <DialogActions><Button onClick={() => setAccepted(true)}>Continue with Tamarind compute</Button></DialogActions>
        </Dialog> : <>
            <Box sx={{px:2, py:0.5, bgcolor:'#eef5f7', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <Typography variant="body2">Compute: Tamarind · personal account configured on this computer</Typography>
                <Button size="small" onClick={() => setOpen(true)}>Recent compute jobs</Button>
            </Box>
            {children}
        </>}
        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
            <DialogTitle>Recent Tamarind jobs</DialogTitle>
            <DialogContent>
                <Typography variant="body2" sx={{mb:2}}>These are the latest 100 jobs created by this installation with its current API key. If submission was interrupted, check here before starting another run.</Typography>
                {error && <Alert severity="error">{error}</Alert>}
                {!busy && !jobs.length && <Typography>No jobs yet.</Typography>}
                <Stack spacing={2}>{jobs.map(job => <Box key={job.id} sx={{borderBottom:1,borderColor:'divider',pb:2}}>
                    <Typography>{job.service} · {job.status}</Typography>
                    <Typography variant="caption" sx={{wordBreak:'break-all'}}>{job.jobName}</Typography>
                    {job.message && <Typography variant="body2">{job.message}</Typography>}
                    <Stack direction="row" spacing={1}>
                        {job.status === 'COMPLETED' && <Button disabled={busy} onClick={() => download(job).catch(e => setError(e.message))}>Show result files</Button>}
                        {['PENDING','RUNNING'].includes(job.status) && <Button color="error" disabled={busy} onClick={() => action(() => computeRequest(job['@url'], {method:'DELETE'}))}>Cancel job</Button>}
                    </Stack>
                    {job.files?.map(file => <div key={file.id}><a href={file['@content']} download={file.path.split('/').pop()}>{file.path}</a></div>)}
                </Box>)}</Stack>
            </DialogContent>
            <DialogActions><Button disabled={busy} onClick={refresh}>Refresh</Button><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
        </Dialog>
    </>;
}
