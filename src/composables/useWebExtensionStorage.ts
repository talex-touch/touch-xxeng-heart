import { StorageSerializers } from '@vueuse/core'
import { pausableWatch, toValue, tryOnScopeDispose } from '@vueuse/shared'
import { ref, shallowRef } from 'vue-demi'
import { storage } from 'webextension-polyfill'

import type {
  StorageLikeAsync,
  UseStorageAsyncOptions,
} from '@vueuse/core'
import type { MaybeRefOrGetter, RemovableRef } from '@vueuse/shared'
import type { Ref } from 'vue-demi'
import type { Storage } from 'webextension-polyfill'

export type WebExtensionStorageOptions<T> = UseStorageAsyncOptions<T>

/**
 * `ref(obj)` returns a reactive proxy over the *same* target, so handing it a shared
 * module singleton (e.g. `defaultSettings`) lets every edit mutate that singleton —
 * and `mergeSettings` then spreads the polluted object as if it were pristine.
 * Every use of the default value goes through here.
 */
function cloneDefault<T>(value: T): T {
  if (value == null || typeof value !== 'object')
    return value

  try {
    return structuredClone(value)
  }
  catch {
    // structuredClone rejects functions and proxies; JSON is enough for plain settings.
    return JSON.parse(JSON.stringify(value)) as T
  }
}

// https://github.com/vueuse/vueuse/blob/658444bf9f8b96118dbd06eba411bb6639e24e88/packages/core/useStorage/guess.ts
function guessSerializerType(rawInit: unknown) {
  return rawInit == null
    ? 'any'
    : rawInit instanceof Set
      ? 'set'
      : rawInit instanceof Map
        ? 'map'
        : rawInit instanceof Date
          ? 'date'
          : typeof rawInit === 'boolean'
            ? 'boolean'
            : typeof rawInit === 'string'
              ? 'string'
              : typeof rawInit === 'object'
                ? 'object'
                : Number.isNaN(rawInit)
                  ? 'any'
                  : 'number'
}

const storageInterface: StorageLikeAsync = {
  removeItem(key: string) {
    return storage.local.remove(key)
  },

  setItem(key: string, value: string) {
    return storage.local.set({ [key]: value })
  },

  async getItem(key: string) {
    const storedData = await storage.local.get(key)

    const value = storedData[key]
    return typeof value === 'string'
      ? value
      : value == null
        ? null
        : JSON.stringify(value)
  },
}

/**
 * https://github.com/vueuse/vueuse/blob/658444bf9f8b96118dbd06eba411bb6639e24e88/packages/core/useStorageAsync/index.ts
 *
 * @param key
 * @param initialValue
 * @param options
 */
export function useWebExtensionStorage<T>(
  key: string,
  initialValue: MaybeRefOrGetter<T>,
  options: WebExtensionStorageOptions<T> = {},
): { data: RemovableRef<T>, dataReady: Promise<T> } {
  const {
    flush = 'pre',
    deep = true,
    listenToStorageChanges = true,
    writeDefaults = true,
    mergeDefaults = false,
    shallow,
    eventFilter,
    onError = (e) => {
      console.error(e)
    },
  } = options

  const rawInit: T = toValue(initialValue)
  const type = guessSerializerType(rawInit)

  const data = (shallow ? shallowRef : ref)(cloneDefault(rawInit)) as Ref<T>
  const serializer = options.serializer ?? StorageSerializers[type]

  async function read(event?: { key: string, newValue: unknown }) {
    if (event && event.key !== key)
      return

    try {
      const rawValue = event
        ? typeof event.newValue === 'string'
          ? event.newValue
          : event.newValue == null
            ? event.newValue
            : JSON.stringify(event.newValue)
        : await storageInterface.getItem(key)
      if (rawValue == null) {
        data.value = cloneDefault(rawInit)
        if (writeDefaults && rawInit !== null)
          await storageInterface.setItem(key, await serializer.write(rawInit))
      }
      else if (mergeDefaults) {
        const value = await serializer.read(rawValue) as T
        if (typeof mergeDefaults === 'function')
          data.value = mergeDefaults(value, cloneDefault(rawInit))
        else if (type === 'object' && !Array.isArray(value))
          data.value = { ...(cloneDefault(rawInit) as Record<keyof unknown, unknown>), ...(value as Record<keyof unknown, unknown>) } as T
        else data.value = value
      }
      else {
        data.value = await serializer.read(rawValue) as T
      }
    }
    catch (error) {
      onError(error)
    }
  }

  async function write() {
    try {
      await (
        data.value == null
          ? storageInterface.removeItem(key)
          : storageInterface.setItem(key, await serializer.write(data.value))
      )
    }
    catch (error) {
      onError(error)
    }
  }

  const { pause: pauseWatch, resume: resumeWatch } = pausableWatch(
    data,
    write,
    {
      flush,
      deep,
      eventFilter,
    },
  )

  // The initial read assigns `data.value`, which would otherwise trip the watcher and
  // write the whole blob straight back. With popup + sidepanel + options + every content
  // script mounting at once, those redundant writes stomp each other.
  const dataReadyPromise = new Promise<T>((resolve, reject) => {
    pauseWatch()
    read()
      .then(() => resolve(data.value))
      .catch(reject)
      .finally(resumeWatch)
  })

  if (listenToStorageChanges) {
    const listener = async (changes: Record<string, Storage.StorageChange>) => {
      try {
        pauseWatch()
        for (const [key, change] of Object.entries(changes)) {
          await read({
            key,
            newValue: change.newValue,
          })
        }
      }
      finally {
        resumeWatch()
      }
    }

    storage.onChanged.addListener(listener)

    tryOnScopeDispose(() => {
      storage.onChanged.removeListener(listener)
    })
  }

  return {
    data: data as RemovableRef<T>,
    dataReady: dataReadyPromise,
  }
}
