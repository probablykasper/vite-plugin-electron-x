import { BuildOptions as ViteBuildOptions, PluginOption, ResolvedConfig } from 'vite'
import path from 'path'

type RollupOptions = Exclude<ViteBuildOptions['rollupOptions'], undefined>

export type Options = {
	/** Setting this to `false` disables the dev server. */
	dev?: DevOptions | false
	/** Setting this to `false` disables bundling of main, in case you only want to use the dev server.
	 * @default false */
	main: BuildOptions | false
	/** @default false */
	preload?: BuildOptions | false
}
export type DevOptions = {
	/** Environment variables to pass to the Electron main process.
	 *
	 * The following variables will be automatically provided:
	 * - `VITE_DEV_SERVER_URL`
	 * - `VITE_DEV_SERVER_HOSTNAME`
	 * - `VITE_DEV_SERVER_PORT`
	 * @default {} */
	env?: NodeJS.ProcessEnv
	/** The electron entrypoint. You don't need to set this if you already have `main.entry`. */
	entry?: string
}
export type BuildOptions = {
	/** Your main or preload electron entrypoint */
	entry: string
	/** Default:
	 * - `${viteOutDir}/electron` for main
	 * - `${viteOutDir}/preload` for preload */
	outDir?: string
	/** What to target, like `node16` or `node14.17.0` */
	target?: ViteBuildOptions['target']
	/** Override Vite's sourcemap option */
	sourcemap?: ViteBuildOptions['sourcemap']
	/** Specify dependencies that shouldn't be bundled.
	 *
	 * **If you use a function, you will need to externalize Electron and Node.js buitlins yourself**
	 *
	 * See https://rollupjs.org/guide/en/#external for more details
	 */
	external?: RollupOptions['external']
	/** Vite plugins */
	plugins?: PluginOption[]
}

export type ResolvedOptions = {
	dev: Required<DevOptions> | false
	main: Required<BuildOptions> | false
	preload: Required<BuildOptions> | false
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
		plugins: options.plugins || [],
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
export function resolveOptions(options: Options, viteConfig: ResolvedConfig): ResolvedOptions {
	const main = resolveBuildOptions('electron', options.main, viteConfig)
	// const mainOurEntry = main.
	return {
		main,
		preload: resolveBuildOptions('preload', options.preload || false, viteConfig),
		dev: resolveDevOptions(options.dev || {}, main),
	}
}
