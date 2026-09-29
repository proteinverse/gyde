import React from 'react';
import {Alert, Box, Button, Checkbox, Chip, FormControlLabel, LinearProgress, Stack, TextField, Typography} from '@mui/material';

export function jobPresentation(status, submitted, importing=false) {
    const states = {
        PENDING: ['Queued', 'Your job is queued on Tamarind. It will start when compute is available.'],
        RECONCILING: ['Confirming submission', 'The response was interrupted. GYDE is checking the existing job; do not submit again.'],
        SUBMITTING: ['Submitting', 'Sending your job to Tamarind.'],
        RUNNING: ['Running', 'Tamarind is running your job. Results will be imported when complete.'],
        CANCELLING: ['Cancelling', 'Cancellation was requested. Waiting for Tamarind to confirm.'],
        CANCELLED: ['Cancelled', 'This job was cancelled.'],
        COMPLETED: importing ? ['Importing results', 'Compute finished. GYDE is importing the results.'] : ['Completed', 'Compute finished. Your outputs are available in Tamarind.'],
        FAILED: ['Failed', 'The job failed. Open Tamarind results for details.'],
        COMMS_ERROR: ['Reconnecting', 'Unable to check progress. GYDE will retry automatically; your job may still be running.'],
    };
    const [label, message] = states[status] || (submitted ? states.SUBMITTING : ['', '']);
    return {label, message, active: importing || submitted && !['COMPLETED','FAILED','CANCELLED'].includes(status)};
}

export default function TamarindServiceForm({parameters, config, errors, update, disabled, fallback,
    status, submitted, importing, resultUrl, error, submit, cancel, cancelling, canCancel, canSubmit, showSubmitButton}) {
    const progress = jobPresentation(status, submitted, importing);
    return <Stack spacing={2.5} sx={{mt:1, '& .MuiOutlinedInput-root':{borderRadius:2}}}>
        <Typography variant="overline" color="text.secondary">Tamarind Bio compute</Typography>
        {parameters.map(param => {
            const locked = disabled(param), value = config[param.id];
            if (!param.array && param.type === 'flag') return <Box key={param.id}>
                <FormControlLabel label={param.name || param.id} control={<Checkbox checked={value === true} disabled={locked}
                    onChange={event => update({key:param.id, value:event.target.checked})}/>} />
                {param.description && <Typography variant="body2" color="text.secondary">{param.description}</Typography>}
            </Box>;
            if (!param.array && ['text','integer','decimal'].includes(param.type)) return <TextField key={param.id}
                fullWidth size="small" label={param.name || param.id} disabled={locked}
                value={value === undefined || Number.isNaN(value) ? '' : value}
                type={param.type === 'text' ? 'text' : 'number'} error={!!errors[param.id]}
                helperText={errors[param.id] || param.description}
                inputProps={{min:param.min,max:param.max,step:param.type === 'integer' ? 1 : 'any'}}
                onChange={event => update({key:param.id, value:param.type === 'text' ? event.target.value :
                    event.target.value === '' ? undefined : Number(event.target.value)})} />;
            return <Box key={param.id}><Typography variant="body2">{param.name || param.id}</Typography>{fallback(param, value, !!errors[param.id])}</Box>;
        })}
        {error && <Alert severity="error">{error}</Alert>}
        {progress.label && <Box role="status" aria-live="polite" sx={{p:2,border:'1px solid',borderColor:'divider',borderRadius:2,bgcolor:'#f8fafc'}}>
            <Chip label={progress.label} size="small" sx={{mb:1}} />
            <Typography variant="body2">{progress.message}</Typography>
            {progress.active && <LinearProgress sx={{mt:2}} />}
            {resultUrl && <Button component="a" href={resultUrl} target="_blank" rel="noopener noreferrer" sx={{mt:1}}>View job in Tamarind</Button>}
            {progress.active && <Typography variant="caption" display="block" sx={{mt:1}}>Closing this dialog does not cancel your job. You can track it in Tamarind My Results.</Typography>}
        </Box>}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
            {canCancel && <Button variant="outlined" color="error" disabled={cancelling || status === 'CANCELLING'} onClick={cancel}>
                {cancelling || status === 'CANCELLING' ? 'Cancelling…' : 'Cancel job'}
            </Button>}
            {showSubmitButton && <Button variant="contained" disableElevation disabled={!canSubmit} onClick={submit}
                sx={{textTransform:'none',borderRadius:2,bgcolor:'#163550','&:hover':{bgcolor:'#214b6e'}}}>
                {progress.active ? progress.label : 'Submit job'}
            </Button>}
        </Stack>
    </Stack>;
}
