import { spawn } from 'child_process'
import { resolve, join } from 'path'
import { default as esbuild, type BuildOptions as EsbuildOptions } from 'esbuild'
import { BuildOptions as ViteBuildOptions, Plugin, ResolvedConfig } from 'vite'
import fs from 'fs'

const electronDir = resolve(process.cwd(), 'node_modules', 'electron')

// imitates `electron/index.js`
function getElectronPath() {
	const pathFile = join(electronDir, 'path.txt')
	console.log(pathFile)

	let executablePath: string | undefined
	if (fs.existsSync(pathFile)) {
		executablePath = fs.readFileSync(pathFile, 'utf-8')
	}
	if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
		return join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || 'electron')
	}
	if (executablePath) {
		return join(electronDir, 'dist', executablePath)
	}
	console.error('Could not get Electron path')
	process.exit(1)
}

// Spawn electron, imitates `electron/cli.js`
async function spawnElectron(args: string[], env: NodeJS.ProcessEnv) {
	const electronPath = getElectronPath()
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
			child.kill(signal)
		}
	}
	process.on('SIGINT', terminationHandler)
	process.on('SIGTERM', terminationHandler)
}

async function resolveOutDir(options: BuildOptions, viteConfig: ResolvedConfig) {
	return options.outDir || resolve(viteConfig.build.outDir, 'electron')
}
function resolveSourcemap(sourcemap: ViteBuildOptions['sourcemap']): EsbuildOptions['sourcemap'] {
	if (sourcemap === true) return 'linked'
	else if (sourcemap === 'inline') return 'linked'
	else if (sourcemap === 'hidden') return 'external'
	else return false
}

async function build(options: BuildOptions, viteConfig: ResolvedConfig): Promise<string> {
	const outDir = await resolveOutDir(options, viteConfig)

	await esbuild.build({
		entryPoints: [options.entry],
		outfile: resolve(outDir, 'main.js'),
		platform: 'node',
		bundle: true,
		format: 'cjs',
		target: 'node16',
		minify: !!viteConfig.build.minify,
		// define,
		sourcemap: resolveSourcemap(viteConfig.build.sourcemap),
		// inject
		// plugins
		external: ['electron', ...(options.external || [])],
	})

	return resolve(outDir, 'main.js')
}

function rmDirIfExists(path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.rm(path, { recursive: true }, (e) => {
			if (e && e?.code != 'ENOENT') {
				reject(e)
			}
			resolve()
		})
	})
}
async function handleOutDirCleaning(options: Options, viteConfig: ResolvedConfig) {
	if (!viteConfig.build.emptyOutDir) {
		return
	}
	if (options.main !== false) {
		const outDir = await resolveOutDir(options.main, viteConfig)
		await rmDirIfExists(outDir)
	}
	if (options.preload) {
		const outDir = await resolveOutDir(options.preload, viteConfig)
		await rmDirIfExists(outDir)
	}
}

const localhosts = ['localhost', '127.0.0.1', '::1', '0000:0000:0000:0000:0000:0000:0000:0001']
export function electron(options: Options): Plugin[] {
	let viteConfig: ResolvedConfig

	const buildPlugin: Plugin = {
		name: 'electron-build-main',
		apply: 'build',
		enforce: 'post',
		configResolved(config) {
			viteConfig = config
		},
		async closeBundle() {
			await handleOutDirCleaning(options, viteConfig)
			if (options.main !== false) {
				await build(options.main, viteConfig)
			}
			if (options.preload) {
				await build(options.preload, viteConfig)
			}
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
			await handleOutDirCleaning(options, viteConfig)
			let mainOutPath: string | undefined
			if (options.main !== false) {
				mainOutPath = await build(options.main, viteConfig)
			}
			if (options.preload) {
				await build(options.preload, viteConfig)
			}

			if (options.dev === false) {
				return
			}
			const devOptions = options.dev || {}
			const devEntry = devOptions.entry || mainOutPath
			if (!devEntry) {
				console.error(
					'No entry point found for Electron dev server. You must specify `main.entry` or `dev.entry`'
				)
				process.exit(1)
			}

			server.httpServer?.once('listening', async () => {
				const address = server.httpServer?.address() || null
				if (address === null || typeof address === 'string') {
					console.error('Unexpected dev server address', address)
					process.exit(1)
				}
				const hostname = localhosts.includes(address.address) ? 'localhost' : address.address
				const protocol = server.config.server.https ? 'https' : 'http'
				const url = `${protocol}://${hostname}:${address.port}`

				const env = devOptions.env || {}
				if (!env.VITE_DEV_SERVER_URL) env.VITE_DEV_SERVER_URL = url
				if (!env.VITE_DEV_SERVER_HOSTNAME) env.VITE_DEV_SERVER_HOSTNAME = hostname
				if (!env.VITE_DEV_SERVER_PORT) env.VITE_DEV_SERVER_PORT = address.port.toString()

				console.log('\nStarting Electron...')
				spawnElectron([devEntry], env)
			})
		},
	}

	return [buildPlugin, servePlugin]
}

export type BuildOptions = {
	/** Your main or preload electron entrypoint */
	entry: string
	outDir?: string
	/** What to target, like `node16` or `node14.17.0` */
	target?: EsbuildOptions['target']
	/** Override Vite's sourcemap option */
	sourcemap?: EsbuildOptions['sourcemap']
	/** Specify dependencies that shouldn't be bundled. Electron is always externalized. */
	external?: EsbuildOptions['external']
}
export type DevOptions = {
	/** @default {} */
	env?: NodeJS.ProcessEnv
	/** The electron entrypoint. You don't need to set this if you already have `main.entry`. */
	entry?: string
}
export type Options = {
	/** Setting this to `false` disables the dev server. */
	dev?: DevOptions | false
	/** Setting this to `false` disables bundling of main, in case you only want to use the dev server.
	 * @default false */
	main: BuildOptions | false
	/** @default false */
	preload?: BuildOptions | false
}
