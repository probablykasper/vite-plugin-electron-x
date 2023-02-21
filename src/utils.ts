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

let child: ReturnType<typeof spawn> | null = null
function exitChild(signal?: NodeJS.Signals | number) {
	if (child) {
		child.removeAllListeners()
		child.kill(signal)
	}
}

// Spawn electron, imitates `electron/cli.js`
export async function spawnElectron(args: string[], env: NodeJS.ProcessEnv) {
	const electronPath = getElectronPath()
	exitChild()
	child = spawn(electronPath, args, { stdio: 'inherit', env, windowsHide: false })
	child.on('exit', (code, signal) => {
		if (code === null) {
			console.error(electronPath, 'exited with code null and signal', signal)
			process.exit(1)
		}
		process.exit(code)
	})

	process.once('exit', exitChild)
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
