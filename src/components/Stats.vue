<template>
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
    <div v-for="(item, index) in overviewItems" :key="index"
      class="card-base animated-border animate-fade" :class="item.containerClass"
      @mouseenter="$event.target.classList.add('hovered')">
      <div class="flex items-start justify-between relative">
        <div>
          <div class="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">{{ item.label }}</div>
          <div class="mt-2 text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            <span>{{ displayValues[index] }}</span><span v-if="item.unit">{{ item.unit }}</span>
          </div>
          <div class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ item.desc }}</div>
        </div>
        <div class="p-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <Icon :icon="item.icon" class="w-6 h-6 transition-colors duration-200" :class="item.iconColor" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { isMonitorOnline, isMonitorAbnormal } from '@/utils/monitor'

const { t } = useI18n()
const props = defineProps({ monitors: { type: Array, default: () => [] } })

const total = computed(() => props.monitors.length)
const normal = computed(() => props.monitors.filter((m) => isMonitorOnline(m.status)).length)
const abnormal = computed(() => props.monitors.filter((m) => isMonitorAbnormal(m.status)).length)
const avgUptime = computed(() => {
  const list = props.monitors.filter((m) => m.stats?.uptime != null)
  if (!list.length) return 0
  return Number((list.reduce((a, m) => a + m.stats.uptime, 0) / list.length).toFixed(2))
})

const displayValues = ref([0, 0, 0, 0])

const animateValue = (start, end, duration, index, decimals = 0) => {
  const t0 = performance.now()
  const tick = (now) => {
    const p = Math.min((now - t0) / duration, 1)
    const val = start + (end - start) * p
    displayValues.value[index] = decimals ? val.toFixed(decimals) : Math.floor(val)
    if (p < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const overviewItems = computed(() => [
  { label: t('stats.totalWebsites'), value: total.value, desc: t('stats.allWebsites'), icon: 'bi:check-circle', iconColor: 'text-emerald-500', containerClass: 'after:border-emerald-500/50 dark:after:border-emerald-400/50' },
  { label: t('stats.normalWebsites'), value: normal.value, desc: t('stats.accessNormal'), icon: 'bi:check-circle-fill', iconColor: 'text-green-500', containerClass: 'after:border-green-500/50 dark:after:border-green-400/50' },
  { label: t('stats.abnormalWebsites'), value: abnormal.value, desc: t('stats.accessAbnormal'), icon: 'bi:x-circle-fill', iconColor: 'text-red-500', containerClass: 'after:border-red-500/50 dark:after:border-red-400/50' },
  { label: t('stats.avgUptime'), value: avgUptime.value, unit: '%', desc: t('stats.last30Days'), icon: 'bi:graph-up-arrow', iconColor: 'text-blue-500', containerClass: 'after:border-blue-500/50 dark:after:border-blue-400/50' }
])

watch(() => overviewItems.value.map((i) => i.value), (vals, old) => {
  vals.forEach((v, i) => {
    const prev = parseFloat(old?.[i]) || 0
    if (v !== prev) animateValue(prev, v, 1000, i, i === 3 ? 2 : 0)
  })
}, { immediate: true })
</script>
