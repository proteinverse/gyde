import {isTamarindCompute} from './compute';
import PersonalCompute from './integrations/tamarind/PersonalCompute';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WithDefaultPinger } from './Pinger';

import { WithUserData } from './UserData';
import { WithTokenService } from './Token';
import { WithEnvironment } from './Environment';
import { WithGydeWorkers } from './GydeWorkerService';

import { WithSlivkaService } from './czekolada/lib';

import 'setimmediate';

import "./style.scss";
import App from './App';
// import App from './gmsa/GMSApp';


import { Buffer } from 'buffer';


// If we don't have a value for Buffer (node core module) create it/polyfill it
if (window.Buffer === undefined) window.Buffer = Buffer;

const root = createRoot(document.getElementById('root'))

function LandingPageAddendum() {
    return (
        <React.Fragment>
            <div style={{fontSize: '12.8px'}}>
                This is a base installation of GYDE.  For more details see ...
            </div>
        </React.Fragment>
    );
}


const application = (
    <WithTokenService>
        <WithUserData>
            <WithDefaultPinger>
                <WithSlivkaService apiPrefix={isTamarindCompute() ? ['/compute/tamarind'] : ['/api2', '/api']}>
                    <WithEnvironment>
                        <WithGydeWorkers>
                            <App landingPageAddendum={<LandingPageAddendum />} />
                        </WithGydeWorkers>
                    </WithEnvironment>
                </WithSlivkaService>
            </WithDefaultPinger>
        </WithUserData>
    </WithTokenService>
);

root.render(isTamarindCompute() ? <PersonalCompute>{application}</PersonalCompute> : application);
