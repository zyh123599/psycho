import "./app.js"

if (globalThis.Capacitor) {
  import("@ionic/core/loader").then(({ defineCustomElements }) => {
    defineCustomElements(window)
  })
}
