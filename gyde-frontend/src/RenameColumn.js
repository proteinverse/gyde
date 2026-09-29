import React, {useState} from 'react';
import {Button, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, TextField} from '@mui/material';

// Change the display/export label, not the stable key used by results and plots.
export default function RenameColumn({columns: allColumns, seqColumns=[], labels={}, onRename}) {
    const columns=allColumns.filter(key=>!seqColumns.some(sequence=>sequence.column===key));
    const [open,setOpen]=useState(false), [column,setColumn]=useState(''), [name,setName]=useState('');
    const close=()=>setOpen(false);
    const duplicate=columns.some(key=>key!==column && (labels[key] || key)===name.trim());
    return <>
        <Button onClick={()=>{setColumn('');setName('');setOpen(true);}}>Rename column</Button>
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
            <DialogTitle>Rename column</DialogTitle>
            <DialogContent>
                <TextField select fullWidth margin="normal" label="Column" value={column} onChange={event=>{
                    const key=event.target.value;setColumn(key);setName(labels[key] || key);
                }}>{columns.map(key=><MenuItem key={key} value={key}>{labels[key] || key}</MenuItem>)}</TextField>
                <TextField fullWidth margin="normal" label="Name" value={name} onChange={event=>setName(event.target.value)}
                    error={duplicate} helperText={duplicate?'Another column already has this name.':''}/>
            </DialogContent>
            <DialogActions><Button onClick={close}>Cancel</Button><Button disabled={!column || !name.trim() || duplicate}
                onClick={()=>{onRename(column,name.trim());close();}}>Save</Button></DialogActions>
        </Dialog>
    </>;
}
