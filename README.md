# vite-plugin-electron-x

[![NPM](https://img.shields.io/npm/v/vite-plugin-electron-x.svg)](https://npmjs.com/package/vite-plugin-electron-x)
[![License](https://img.shields.io/npm/l/vite-plugin-electron-x.svg)](LICENSE)
[![NPM Downloads](https://img.shields.io/npm/dm/vite-plugin-electron-x.svg)](https://npmjs.com/package/vite-plugin-electron-x)

A Vite plugin for bundling `main.ts`, `preload.ts` and running Electron in development.

## Usage

Add the plugin in `vite.config.js` like this:
```ts
export default defineConfig({
  plugins: [
    electronX({
      main: {
        // this will output ./build/electron/main.js
        entry: './src/electron/main.ts',
        outDir: './build/electron',
      },
      preload: {
        // this will output ./build/electro/preload.js
        entry: './src/electron/preload.ts',
        outDir: './build/electron',
      },
    }),
  ]
})
```

You can load the dev server in Electron using `process.env.VITE_DEV_SERVER_URL`:
```js
if (process.env.VITE_DEV_SERVER_URL) {
  win.loadURL(`http://localhost:${process.env.VITE_DEV_SERVER_URL}`)
} else {
  // win.loadURL('your-production-output.html')
}
```

## API

See all options at [src/options.ts](https://github.com/probablykasper/vite-plugin-electron-x/blob/master/src/options.ts)

The Electron main process utomatically receives `VITE_DEV_SERVER_URL`, `VITE_DEV_SERVER_HOSTNAME` and `VITE_DEV_SERVER_PORT`.

## Dev instructions

### Get started

1. Install Node.js
2. Run `npm install`

### Commands
- `npm run dev`: Build and watch
- `npm run build`: Build
- `npm run format`: Format

### Publish new version

1. Update `CHANGELOG.md`
2. Check for errors
    ```
    npm run lint
    ```
3. Bump the version number
    ```
    npm version --no-git-tag <version>
    ```
4. Build the package
    ```
    npm run build
    ```
5. Publish the package
    ```
    npm publish
    ```
6. Commit with a tag in format "v#.#.#"
7. Create GitHub release with release notes
