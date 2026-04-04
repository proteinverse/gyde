import React from 'react';
import { WithDefaultPinger } from './Pinger';

import { WithUserData } from './UserData';
import { WithTokenService } from './Token';
import { WithEnvironment } from './Environment';
import { WithGydeWorkers } from './GydeWorkerService';

import { WithSlivkaService } from './czekolada/lib';

import "./style.scss";

import App from './App';

export function GYDEFrontend(props) {
    return (
        <WithTokenService>
            <WithUserData>
                <WithDefaultPinger>
                    <WithSlivkaService apiPrefix={['/api2', '/api']}>
                        <WithEnvironment>
                            <WithGydeWorkers>
                                <App {...props} />
                            </WithGydeWorkers>
                        </WithEnvironment>
                    </WithSlivkaService>
                </WithDefaultPinger>
            </WithUserData>
        </WithTokenService>
    );
}
