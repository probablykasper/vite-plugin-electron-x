# vite-plugin-electron-x

A Vite plugin for running Electron in development.

## Usage

Add the plugin in `vite.config.js` like this:
```ts
export default defineConfig({
  plugins: [
    electronDevServer({
      env: {
        NODE_ENV: 'development',
      },
    }),
  ]
})
```

Load the Vite dev server in Electron:
```js
if (process.env.NODE_ENV === "development') {
  // vite-plugin-electorn-x automatically provides the VITE_DEV_SERVER_URL environment variable to Electron
  mainWindow.loadURL(`http://localhost:${process.env.VITE_DEV_SERVER_URL}`)
}
```

## Dev instructions

### Get started

1. Install Node.js
2. Run `npm install`

### Commands
- `npm run dev`: Build and watch
- `npm run build`: Build
