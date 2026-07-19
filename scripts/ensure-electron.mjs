import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const executable = require('electron')

if (typeof executable !== 'string' || executable.length === 0) {
  throw new Error('Electron 包没有返回可执行文件路径。')
}

await access(executable)
console.log(`Electron binary ready: ${process.platform}-${process.arch}`)
