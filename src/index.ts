import path from 'path'
import { Plugin, ResolvedConfig, build as viteBuild, ViteDevServer } from 'vite'
import { builtinModules } from 'module'
import { rmDirIfExists, spawnElectron } from './utils'
import { BuildOptions, DevOptions, Options, ResolvedOptions, resolveOptions } from './options'

async function build(options: Required<BuildOptions>, viteConfig: ResolvedConfig): Promise<string> {
	const output = await viteBuild({
		configFile: false,
		publicDir: false,
		mode: 'production',
		plugins: options.plugins,
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
					...options.external,
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

async function handleOutDirCleaning(options: ResolvedOptions, viteConfig: ResolvedConfig) {
	if (!viteConfig.build.emptyOutDir) return
	if (options.main !== false) await rmDirIfExists(options.main.outDir)
	if (options.preload) await rmDirIfExists(options.preload.outDir)
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
