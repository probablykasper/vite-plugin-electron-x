import { spawn } from 'child_process'
import type { Plugin } from 'vite'
// @ts-ignore
import { default as electronPath } from 'electron/index'

// Spawn electron the same way as electron cli
async function spawnElectron(args: string[], env: NodeJS.ProcessEnv) {
	if (typeof electronPath !== 'string') {
		console.error('Could not get Electron path')
		process.exit(1)
	}
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

type ViteElectronOptions = {
	devServerArgs?: string[]
	env?: NodeJS.ProcessEnv
}
export function electronStarter(options: ViteElectronOptions = {}): Plugin {
	return {
		name: 'electron-start',
		configureServer(server) {
			server.httpServer?.once('listening', async () => {
				if (!server.config.server.port) {
					console.error('No dev server port found')
					process.exit(1)
				}
				console.log('\nStarting Electron...')
				const args = options.devServerArgs || ['.']
				const env = options.env || {}
				if (!env.DEV_PORT) env.DEV_PORT = server.config.server.port.toString()
				spawnElectron(args, env)
			})
		},
	}
}
