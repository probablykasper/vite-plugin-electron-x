import path from 'path'
import { Plugin, ResolvedConfig, build as viteBuild, ViteDevServer } from 'vite'
import { builtinModules } from 'module'
import { rmDirIfExists, spawnElectron } from './utils'
import { Options, DevOptions, BuildOptions, ResolvedOptions, resolveOptions } from './options'

export type { Options, DevOptions, BuildOptions } from './options'

async function build(options: Required<BuildOptions>): Promise<string> {
	const output = await viteBuild({
		configFile: false,
		publicDir: false,
		mode: 'production',
		plugins: options.plugins,
		build: {
			target: options.target,
			minify: options.minify,
			emptyOutDir: false,
			sourcemap: options.sourcemap,
			outDir: options.outDir,
			lib: {
				entry: options.entry,
				formats: ['cjs'],
			},
			rollupOptions: {
				external:
					typeof options.external === 'function'
						? options.external
						: [
								'electron',
								...builtinModules.flatMap((m) => [m, `node:${m}`]),
								...[options.external].flat(),
						  ],
				output: {
					entryFileNames: '[name].js',
				},
			},
		},
	})

	// Works for Vite 3 and 4
	if ('addListener' in output || 'on' in output) {
		console.error('Error: Unexpected RollupWatcher')
		process.exit(1)
	}
	const outputs = [output].flat()
	if (outputs.length > 1) {
		console.error('Error: Too many build outputs')
		process.exit(1)
	}
	const entries = []
	for (const item of outputs[0].output) {
		if (item.type === 'chunk' && item.isEntry) {
			entries.push(item)
		}
	}
	if (entries.length !== 1) {
		console.error('Error: Expected 1 output entry, got', entries.length)
		process.exit(1)
	}
	return path.resolve(options.outDir, entries[0].fileName)
}

async function handleOutDirCleaning(options: ResolvedOptions, viteConfig: ResolvedConfig) {
	if (!viteConfig.build.emptyOutDir) return
	if (options.main !== false) await rmDirIfExists(options.main.outDir)
	if (options.preload) await rmDirIfExists(options.preload.outDir)
}

function dev(server: ViteDevServer, options: Required<DevOptions>) {
	const localhosts = ['localhost', '127.0.0.1', '::1', '0000:0000:0000:0000:0000:0000:0000:0001']

	server.httpServer?.once('listening', async () => {
		const address = server.httpServer?.address() || null
		if (address === null || typeof address === 'string') {
			console.error('Error: Unexpected dev server address', address)
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
	var vitePluginElectronXelectronStarted: boolean
}

export function electronX(options: Options): Plugin[] {
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
				await build(resolvedOptions.main)
			}
			if (resolvedOptions.preload) {
				await build(resolvedOptions.preload)
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

			if (global.vitePluginElectronXelectronStarted && options.dev) {
				// avoid dangling electron instances
				console.log('❗You may need to restart Electron to see your changes.')
				return
			}
			global.vitePluginElectronXelectronStarted = true

			await handleOutDirCleaning(resolvedOptions, viteConfig)
			if (resolvedOptions.main !== false) {
				const outputEntry = await build(resolvedOptions.main)
				if (resolvedOptions.dev !== false) {
					resolvedOptions.dev.entry = outputEntry
				}
			}
			if (resolvedOptions.preload) {
				await build(resolvedOptions.preload)
			}

			if (resolvedOptions.dev !== false) {
				dev(server, resolvedOptions.dev)
			}
		},
	}

	return [buildPlugin, servePlugin]
}
