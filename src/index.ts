import { spawn } from 'child_process'
import { resolve } from 'path'
import { build as viteBuild, Plugin, ResolvedConfig } from 'vite'
// @ts-ignore
import { default as electronPath } from 'electron/index'

// Spawn electron the same way as electron cli
async function spawnElectron(args: string[], env: NodeJS.ProcessEnv) {
	if (typeof electronPath !== 'string') {
		console.error('Could not get Electron path')
		process.exit(1)
	}
	const child = spawn(electronPath, args, { stdio: 'ignore', env, windowsHide: false })
	child.on('close', (code, signal) => {
		if (code === null) {
			console.error(electronPath, 'exited with signal', signal)
			process.exit(1)
		}
		process.exit(code)
	})

	function terminationHandler(signal: NodeJS.Signals) {
		if (!child.killed) {
			console.log('- !killed')
			child.kill(signal)
		}
	}
	process.on('SIGINT', terminationHandler)
	process.on('SIGTERM', terminationHandler)
}

async function build(options: ViteElectronOptions, viteConfig: ResolvedConfig): Promise<string> {
	if (options.main === false) return options.entry
	if (options.main === true) options.main = {}

	const outDir = options.main?.outDir || resolve(viteConfig.build.outDir, 'electron')
	const fileName = 'main'

	await viteBuild({
		configFile: false, // Don't load user config file
		publicDir: false,
		mode: viteConfig.mode,
		build: {
			minify: viteConfig.build.minify,
			emptyOutDir: viteConfig.build.emptyOutDir,
			outDir,
			lib: {
				entry: options.entry,
				formats: ['cjs'],
				fileName,
			},
		},
	})
	return resolve(outDir, fileName + '.js')
}

const localhosts = ['localhost', '127.0.0.1', '::1', '0000:0000:0000:0000:0000:0000:0000:0001']
export function electron(options: ViteElectronOptions): Plugin[] {
	let viteConfig: ResolvedConfig

	const buildPlugin: Plugin = {
		name: 'electron-build-main',
		apply: 'build',
		enforce: 'post',
		configResolved(config) {
			viteConfig = config
		},
		async closeBundle() {
			await build(options, viteConfig)
		},
	}

	const servePlugin: Plugin = {
		name: 'electron-dev-server',
		apply: 'serve',
		enforce: 'post',
		configResolved(config) {
			viteConfig = config
		},
		async configureServer(server) {
			const mainPath = await build(options, viteConfig)

			server.httpServer?.once('listening', async () => {
				const address = server.httpServer?.address() || null
				if (address === null || typeof address === 'string') {
					console.error('Unexpected dev server address', address)
					process.exit(1)
				}
				const hostname = localhosts.includes(address.address) ? 'localhost' : address.address
				const protocol = server.config.server.https ? 'https' : 'http'
				const url = `${protocol}://${hostname}:${address.port}`

				const env = options.env || {}
				if (!env.VITE_DEV_SERVER_URL) env.VITE_DEV_SERVER_URL = url
				if (!env.VITE_DEV_SERVER_HOSTNAME) env.VITE_DEV_SERVER_HOSTNAME = hostname
				if (!env.VITE_DEV_SERVER_PORT) env.VITE_DEV_SERVER_PORT = address.port.toString()

				console.log('\nStarting Electron...')
				spawnElectron([mainPath], env)
			})
		},
	}

	return [buildPlugin, servePlugin]
}

export type ViteElectronOptions = {
	env?: NodeJS.ProcessEnv
	/** Your Electron entrypoint. Used for the dev server and for building */
	entry: string
	main?:
		| {
				outDir?: string
		  }
		| boolean
}
