import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const electronDir = path.resolve(process.cwd(), 'node_modules', 'electron')

// imitates `electron/index.js`
function getElectronPath() {
	const pathFile = path.join(electronDir, 'path.txt')

	let executablePath: string | undefined
	if (fs.existsSync(pathFile)) {
		executablePath = fs.readFileSync(pathFile, 'utf-8')
	}
	if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
		return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || 'electron')
	}
	if (executablePath) {
		return path.join(electronDir, 'dist', executablePath)
	}
	console.error('Error: Could not get Electron path')
	process.exit(1)
}

// Spawn electron, imitates `electron/cli.js`
export async function spawnElectron(args: string[], env: NodeJS.ProcessEnv) {
	const electronPath = getElectronPath()
	const child = spawn(electronPath, args, { stdio: 'inherit', env, windowsHide: false })
	child.on('close', (code, signal) => {
		if (code === null) {
			console.error(electronPath, 'exited with signal', signal)
			process.exit(1)
		}
		process.exit(code)
	})

	function terminationHandler(signal: NodeJS.Signals) {
		if (!child.killed) {
			child.kill(signal)
		}
	}
	process.on('SIGINT', terminationHandler)
	process.on('SIGTERM', terminationHandler)
}

export function rmDirIfExists(path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.rm(path, { recursive: true }, (e) => {
			if (e && e?.code != 'ENOENT') {
				reject(e)
			}
			resolve()
		})
	})
}
