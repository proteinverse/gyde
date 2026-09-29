import React from 'react';
import TamarindLogo from './TamarindLogo';
import {Box, Chip, Stack, Typography, ThemeProvider, createTheme} from '@mui/material';

const theme = createTheme({
    palette: {primary: {main: '#24734f'}},
    typography: {fontFamily: 'Inter, Arial, sans-serif', button: {textTransform: 'none'}, h6: {fontWeight: 600}},
    shape: {borderRadius: 8},
    components: {
        MuiTextField: {defaultProps: {size: 'small'}},
        MuiOutlinedInput: {styleOverrides: {root: {backgroundColor: '#f7f7f7'}}},
        MuiButton: {defaultProps: {disableElevation: true}},
    },
});
export const predictionName = method => ({
    'af2':'AlphaFold2', 'boltz-2':'Boltz-2', 'chai-1':'Chai-1',
    'openfold3-v1':'OpenFold3', 'abodybuilder2':'ABodyBuilder2', 'ibex':'ABodyBuilder3',
}[method] || method);
export const predictionMenuLabel = (name, hosted) => hosted
    ? <>{name.replace(/ \(Tamarind(?: Bio)?\)$/, '')}<TamarindLogo/></> : name;

export function PredictionTheme({hosted, children}) {
    return hosted ? <ThemeProvider theme={theme}>{children}</ThemeProvider> : children;
}

export function PredictionInputs({infos}) {
    return <Stack spacing={2}>
        <Typography variant="overline" color="text.secondary">Selected GYDE inputs</Typography>
        <Typography variant="body2" color="text.secondary">Inputs come from your selected dataset. Change the selection in GYDE to use different sequences.</Typography>
        {infos.map((info, index) => <Box key={index}>
            {infos.length > 1 && <Typography variant="subtitle2" sx={{mb:1}}>Prediction {index + 1}</Typography>}
            <Stack spacing={1}>{[
                ['Protein', info.proteinSequences], ['Ligand', info.ligands], ['DNA', info.dnas], ['RNA', info.rnas],
            ].flatMap(([type, values]) => (values || []).map((value, i) =>
                <Box key={`${type}-${i}`} sx={{border:'1px solid #ddd',borderRadius:2,p:2}}>
                    <Chip size="small" variant="outlined" label={`${type} ${i + 1}`} />
                    <Typography component="pre" sx={{fontFamily:'monospace',fontSize:13,whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:120,overflow:'auto',mt:1,mb:0}}>{value}</Typography>
                </Box>
            ))}</Stack>
        </Box>)}
    </Stack>;
}
