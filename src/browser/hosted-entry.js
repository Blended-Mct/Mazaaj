// Entry point for the hosted demo (one self-contained HTML page, no server).
// Built by scripts/build-hosted-demo.mjs.

import { useLocalTransport } from '../../public/js/lib.js';
import { start } from '../../public/js/app.js';
import { createLocalServer } from './local-server.js';

useLocalTransport(createLocalServer());
start();
