<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import browser from 'webextension-polyfill'
import type { Storage } from 'webextension-polyfill'
import { deletePageTranslationActivation, readPageTranslationActivations, upsertPageTranslationActivation } from '~/logic/pageTranslationRules'
import { pageTranslationActivationsStorageKey } from '~/logic/storageKeys'
import { formatDateTime } from '~/logic/format'
import type { PageTranslationActivation, PageTranslationScope } from '~/logic/types'

interface RuleRow {
  key: string
  activation: PageTranslationActivation
}

const rows = ref<RuleRow[]>([])
const page = ref(1)
const pageSize = 10
const busyKey = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize)))
const pagedRows = computed(() => rows.value.slice((page.value - 1) * pageSize, page.value * pageSize))

const scopeLabels: Record<PageTranslationScope, string> = {
  url: '当前链接',
  site: '站点',
  regex: 'Regex',
}

function rulePattern(activation: PageTranslationActivation) {
  if (activation.scope === 'site')
    return activation.host
  if (activation.scope === 'regex')
    return activation.regex

  return activation.url
}

async function reload() {
  const map = await readPageTranslationActivations()
  rows.value = Object.entries(map)
    .map(([key, activation]) => ({ key, activation }))
    .sort((a, b) => b.activation.updatedAt - a.activation.updatedAt)
  if (page.value > totalPages.value)
    page.value = totalPages.value
}

async function toggleRule(row: RuleRow) {
  busyKey.value = row.key
  try {
    await upsertPageTranslationActivation({ ...row.activation, enabled: !row.activation.enabled, updatedAt: Date.now() })
    await reload()
  }
  finally {
    busyKey.value = ''
  }
}

async function removeRule(row: RuleRow) {
  busyKey.value = row.key
  try {
    await deletePageTranslationActivation(row.key)
    await reload()
  }
  finally {
    busyKey.value = ''
  }
}

function onStorageChanged(changes: Record<string, Storage.StorageChange>, areaName: string) {
  if (areaName === 'local' && changes[pageTranslationActivationsStorageKey])
    void reload()
}

onMounted(() => {
  void reload()
  browser.storage.onChanged.addListener(onStorageChanged)
})

onBeforeUnmount(() => {
  browser.storage.onChanged.removeListener(onStorageChanged)
})
</script>

<!-- 已保存页面规则的审计入口：停用、删除都在这里；新增规则只能从侧边栏的启动流程产生。 -->
<template>
  <section class="settings-card">
    <header class="settings-card__head">
      <div>
        <h2>已保存的页面规则</h2>
        <p>命中这些规则的页面会自动恢复双语翻译。规则在侧边栏启动翻译并选择范围时创建。</p>
      </div>
      <span v-if="rows.length" class="text-12px text-neutral-500">共 {{ rows.length }} 条</span>
    </header>

    <EmptyState v-if="!rows.length" text="还没有保存的页面规则。在侧边栏点击「翻译此页」并选择当前链接、当前站点或 Regex 范围后，规则会出现在这里。" />

    <template v-else>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-12px">
          <thead class="text-neutral-500">
            <tr class="border-b border-neutral-200">
              <th class="py-2 pr-3 font-500">
                范围
              </th>
              <th class="py-2 pr-3 font-500">
                匹配
              </th>
              <th class="py-2 pr-3 font-500">
                状态
              </th>
              <th class="py-2 pr-3 font-500">
                最后修改
              </th>
              <th class="py-2 font-500">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pagedRows" :key="row.key" class="border-b border-neutral-100">
              <td class="py-2.5 pr-3 whitespace-nowrap">
                {{ scopeLabels[row.activation.scope] }}
              </td>
              <td class="max-w-[22rem] truncate py-2.5 pr-3 font-mono text-11.5px" :title="rulePattern(row.activation)">
                {{ rulePattern(row.activation) }}
              </td>
              <td class="py-2.5 pr-3">
                <ToggleSwitch
                  :model-value="row.activation.enabled"
                  :disabled="busyKey === row.key"
                  :label="`启用规则 ${rulePattern(row.activation)}`"
                  @update:model-value="toggleRule(row)"
                />
              </td>
              <td class="py-2.5 pr-3 whitespace-nowrap text-neutral-500">
                {{ formatDateTime(row.activation.updatedAt) }}
              </td>
              <td class="py-2.5">
                <BaseButton variant="danger" size="sm" :disabled="busyKey === row.key" @click="removeRule(row)">
                  删除
                </BaseButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="mt-3 flex items-center justify-between gap-3">
        <span class="text-12px text-neutral-500">第 {{ page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <BaseButton size="sm" :disabled="page <= 1" @click="page -= 1">
            上一页
          </BaseButton>
          <BaseButton size="sm" :disabled="page >= totalPages" @click="page += 1">
            下一页
          </BaseButton>
        </div>
      </div>
    </template>
  </section>
</template>
