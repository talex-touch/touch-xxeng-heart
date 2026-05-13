declare const __DEV__: boolean
/** Extension name, defined in packageJson.name */
declare const __NAME__: string
/** Extension version, defined in packageJson.version */
declare const __VERSION__: string
/** Browser target, defined in Vite configs */
declare const __FIREFOX__: boolean

declare module '*.vue' {
  const component: any
  export default component
}
