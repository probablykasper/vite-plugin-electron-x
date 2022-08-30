import { spawn } from 'child_process'
import path from 'path'
import {
	Plugin,
	ResolvedConfig,
	build as viteBuild,
	BuildOptions as ViteBuildOptions,
	ViteDevServer,
} from 'vite'
import fs from 'fs'
import { builtinModules } from 'module'

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

async function build(options: Required<BuildOptions>, viteConfig: ResolvedConfig): Promise<string> {
	const output = await viteBuild({
		configFile: false,
		publicDir: false,
		mode: 'production',
		build: {
			target: options.target,
			minify: viteConfig.build.minify,
			emptyOutDir: false,
			sourcemap: viteConfig.build.sourcemap,
			outDir: options.outDir,
			lib: {
				entry: options.entry,
				formats: ['cjs'],
			},
			rollupOptions: {
				external: [
					'electron',
					...builtinModules.flatMap((m) => [m, `node:${m}`]),
					...options.external.map((p) => path.resolve(p)),
				],
				output: {
					entryFileNames: '[name].js',
				},
			},
		},
	})

	if ('addListener' in output) {
		console.error('Unexpected RollupWatcher')
		process.exit(1)
	}
	const outputs = [output].flat()
	if (outputs.length > 1) {
		console.error('Too many build outputs')
		process.exit(1)
	}
	const entries = []
	for (const item of outputs[0].output) {
		if (item.type === 'chunk' && item.isEntry) {
			entries.push(item)
		}
	}
	if (entries.length !== 1) {
		console.error('Expected 1 output entry, got', entries.length)
		process.exit(1)
	}
	return path.resolve(options.outDir, entries[0].fileName)
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
async function handleOutDirCleaning(options: ResolvedOptions, viteConfig: ResolvedConfig) {
	if (!viteConfig.build.emptyOutDir) return
	if (options.main !== false) await rmDirIfExists(options.main.outDir)
	if (options.preload) await rmDirIfExists(options.preload.outDir)
}

function resolveBuildOptions(
	outDirName: 'electron' | 'preload',
	options: BuildOptions | false,
	viteConfig: ResolvedConfig
): Required<BuildOptions> | false {
	if (options === false) return false
	return {
		outDir: options.outDir || path.resolve(viteConfig.build.outDir, outDirName),
		entry: options.entry,
		external: options.external || [],
		sourcemap: options.sourcemap || viteConfig.build.sourcemap,
		target: options.target || 'node16',
	}
}
function resolveDevOptions(
	dev: DevOptions | false,
	main: BuildOptions | false
): Required<DevOptions> | false {
	if (dev === false) return false

	let entry
	if (dev.entry) {
		entry = dev.entry
	} else if (main && main.outDir) {
		const basename = path.basename(main.entry)
		entry = path.resolve(main.outDir, basename)
	} else {
		console.error(
			'No entry point found for Electron dev server. You must specify `main.entry` or `dev.entry`'
		)
		process.exit(1)
	}

	return {
		env: dev.env || {},
		entry,
	}
}
function resolveOptions(options: Options, viteConfig: ResolvedConfig): ResolvedOptions {
	const main = resolveBuildOptions('electron', options.main, viteConfig)
	// const mainOurEntry = main.
	return {
		main,
		preload: resolveBuildOptions('preload', options.preload || false, viteConfig),
		dev: resolveDevOptions(options.dev || {}, main),
	}
}

function dev(server: ViteDevServer, options: Required<DevOptions>) {
	server.httpServer?.once('listening', async () => {
		const address = server.httpServer?.address() || null
		if (address === null || typeof address === 'string') {
			console.error('Unexpected dev server address', address)
			process.exit(1)
		}
		const protocol = server.config.server.https ? 'https' : 'http'
		const hostname = localhosts.includes(address.address) ? 'localhost' : address.address
		const defaultEnv = {
			VITE_DEV_SERVER_URL: `${protocol}://${hostname}:${address.port}`,
			VITE_DEV_SERVER_HOSTNAME: hostname,
			VITE_DEV_SERVER_PORT: address.port.toString(),
		}
		const env = { ...defaultEnv, ...options.env }

		console.log('\nStarting Electron...')
		await spawnElectron([options.entry], env)
	})
}

/* eslint-disable no-var */
declare global {
	var electronStarted: boolean
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
			const resolvedOptions = resolveOptions(options, viteConfig)
			await handleOutDirCleaning(resolvedOptions, viteConfig)
			if (resolvedOptions.main !== false) {
				await build(resolvedOptions.main, viteConfig)
			}
			if (resolvedOptions.preload) {
				await build(resolvedOptions.preload, viteConfig)
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
			const resolvedOptions = resolveOptions(options, viteConfig)

			if (global.electronStarted && options.dev) {
				// avoid dangling electron instances
				console.log('❗You may need to restart Electron to see your changes.')
				return
			}
			global.electronStarted = true

			await handleOutDirCleaning(resolvedOptions, viteConfig)
			if (resolvedOptions.main !== false) {
				const outputEntry = await build(resolvedOptions.main, viteConfig)
				if (resolvedOptions.dev !== false) {
					resolvedOptions.dev.entry = outputEntry
				}
			}
			if (resolvedOptions.preload) {
				await build(resolvedOptions.preload, viteConfig)
			}

			if (resolvedOptions.dev !== false) {
				dev(server, resolvedOptions.dev)
			}
		},
	}

	return [buildPlugin, servePlugin]
}

export type DevOptions = {
	/** @default {} */
	env?: NodeJS.ProcessEnv
	/** The electron entrypoint. You don't need to set this if you already have `main.entry`. */
	entry?: string
}
export type BuildOptions = {
	/** Your main or preload electron entrypoint */
	entry: string
	outDir?: string
	/** What to target, like `node16` or `node14.17.0` */
	target?: ViteBuildOptions['target']
	/** Override Vite's sourcemap option */
	sourcemap?: ViteBuildOptions['sourcemap']
	/** Specify dependencies that shouldn't be bundled. Electron is always externalized. */
	external?: string[]
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
type ResolvedOptions = {
	dev: Required<DevOptions> | false
	main: Required<BuildOptions> | false
	preload: Required<BuildOptions> | false
}
