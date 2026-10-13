import helloMd from '../../../../examples/hello.md?raw'
import helloRuntpt from '../../../../examples/hello.runtpt?raw'
import type { LoadedDoc } from '../types.js'

export const DEMO_RUNBOOK: LoadedDoc = {
  source: {
    origin: 'bundled',
    path: 'examples/hello.md',
    label: 'examples/hello.md (bundled demo)',
    sha: '9f1cde0a',
    writable: false,
  },
  text: helloMd,
}

export const DEMO_RECORDING = helloRuntpt
