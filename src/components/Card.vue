<template>
  <div v-if="loading && !error" class="flex items-center justify-center p-12">
    <Icon icon="svg-spinners:180-ring-with-bg" class="w-12 h-12 text-gray-400 dark:text-gray-300 animate-spin" />
  </div>
  <template v-else>
    <div v-if="error" :class="loading ? 'flex items-center justify-center p-12' : 'mb-6'">
      <div class="flex flex-col items-center gap-4 p-8 rounded-2xl
        bg-red-50/50 dark:bg-red-900/20 border-2 border-red-100 dark:border-red-800/50 backdrop-blur-sm animate-fade">
        <Icon icon="carbon:warning-filled" class="w-12 h-12 text-red-500/90 dark:text-red-400/90" />
        <div class="text-red-600 dark:text-red-400 font-medium text-center">{{ error }}</div>
      </div>
    </div>
    <TransitionGroup v-if="!loading" tag="div"
      class="flex flex-wrap gap-6"
      move-class="sort-move">
    <div v-for="monitor in sortedMonitors" :key="monitor.id"
      class="sort-item w-full">
    <div class="card-base animated-border p-6 rounded-2xl backdrop-blur-sm animate-fade"
         :class="cardBorderClass(monitor.status)"
         @mouseenter="$event.target.classList.add('hovered')"
    >
      <!-- 卡片头部：标题和状态指示器 -->
      <div class="flex items-start sm:items-center justify-between gap-3 sm:gap-4 mb-6">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="text-lg sm:text-xl font-bold truncate text-gray-800 dark:text-gray-100">
              {{ monitor.friendlyName }}
            </h2>
            <Icon 
              icon="bi:link-45deg" 
              class="w-5 h-5 p-1.5 rounded-full transition-colors duration-200
                text-gray-400 hover:text-gray-600 hover:bg-gray-100
                dark:text-gray-500 dark:hover:text-gray-400 dark:hover:bg-gray-700/50
                box-content"
              @click="openUrl(monitor.url)"
            />
            <button
              @click="openDowntimeModal(monitor)"
              class="p-1.5 rounded-full transition-colors duration-200
                text-gray-400 hover:text-gray-600 hover:bg-gray-100
                dark:text-gray-500 dark:hover:text-gray-400 dark:hover:bg-gray-700/50"
              :title="t('card.downtimeRecords')"
            >
              <Icon 
                icon="bi:file-text" 
                class="w-5 h-5"
              />
            </button>
          </div>
        </div>
        <div class="shrink-0">
          <div v-if="typeof monitor.status !== 'undefined'"
               :class="[
                 'inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-medium text-sm whitespace-nowrap',
                 statusBadgeClass(monitor.status)
               ]"
          >
            <div class="relative flex">
              <div :class="[
                'w-3 h-3 rounded-full',
                getStatusClasses(monitor.status).dot
              ]"></div>
              <div :class="[
                'absolute inset-0 w-3 h-3 rounded-full animate-ping opacity-75',
                getStatusClasses(monitor.status).dotPing
              ]"></div>
            </div>
            <span>{{ getStatusLabel(monitor.status) }}</span>
          </div>
        </div>
      </div>

      <!-- 卡片主体：统计数据和图表 -->
      <div class="space-y-3">
        <!-- 响应时间、运行时间和状态时间线 一行三列 -->
        <div class="grid grid-cols-3 gap-3">
          <div class="inner-card relative cursor-pointer p-3" @click="openResponseTimeModal(monitor)">
            <Icon 
              icon="ri:line-chart-line"
              :class="[
                'absolute top-2 right-2 w-3 h-3 p-0.5 rounded-full transition-colors duration-200 box-content',
                getStatusClasses(monitor.status).text,
                getStatusClasses(monitor.status).hover.text,
                getStatusClasses(monitor.status).hover.bg
              ]"
            />
            <div class="text-2xs text-gray-500 dark:text-gray-400 mb-0.5">{{ t('card.avgResponseTime') }}</div>
            <div class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {{ formatters.responseTime(monitor) }}
            </div>
          </div>
          <div class="inner-card p-3">
            <div class="text-2xs text-gray-500 dark:text-gray-400 mb-0.5">{{ t('card.avgUptime') }}</div>
            <div class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {{ formatters.uptime(monitor.stats?.uptime) }}
            </div>
          </div>
          <div class="inner-card p-3">
            <div class="h-8">
              <Scatter v-if="chartOf(monitor).data" :data="chartOf(monitor).data" :options="chartOf(monitor).options" />
            </div>
            <div class="flex justify-between text-2xs text-gray-400 mt-1">
              <span>{{ t('card.daysAgo') }}</span>
              <span class="text-gray-500">{{ getDowntimeStats(monitor) }}</span>
              <span>{{ t('card.today') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    </TransitionGroup>
  </template>

  <!-- 响应时间详情模态框 -->
  <Teleport to="body">
    <div v-if="modalMounted" 
         class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <!-- 背景遮罩 -->
      <Transition
        appear
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        enter-active-class="transition-opacity duration-300"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
        leave-active-class="transition-opacity duration-300"
      >
        <div v-show="showResponseTimeModal"
             class="absolute inset-0 bg-black/60" 
             @click="closeModal"
        ></div>
      </Transition>
      
      <!-- 模态框内容 -->
      <Transition
        appear
        enter-from-class="opacity-0 translate-y-4 scale-95"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        enter-active-class="transition-all duration-300 transform"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-4 scale-95"
        leave-active-class="transition-all duration-300 transform"
        @after-leave="onAfterLeave"
      >
        <div v-show="showResponseTimeModal"
             class="relative bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-3xl
                    shadow-xl border border-gray-200 dark:border-gray-700
                    max-h-[90vh] overflow-y-auto"
             @click.stop
        >
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {{ t('card.responseTimeTrend') }}
            </h3>
            <button @click="closeModal"
                    class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full 
                           transition-colors duration-200">
              <Icon icon="carbon:close" 
                    class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          
          <div class="h-[300px]">
            <div v-if="rtLoading" class="h-full flex items-center justify-center">
              <Icon icon="svg-spinners:180-ring-with-bg" class="w-10 h-10 text-gray-400" />
            </div>
            <div v-else-if="rtCountdown > 0 || rtError" class="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
              <Icon icon="carbon:warning-filled" class="w-10 h-10 text-amber-500" />
              <p class="text-sm text-gray-600 dark:text-gray-400">
                {{ rtCountdown > 0 ? t('error.rateLimitWait', { seconds: rtCountdown }) : rtError }}
              </p>
            </div>
            <div v-else-if="!selectedMonitor?.stats?.avgResponseTime"
                 class="h-full flex flex-col items-center justify-center gap-4">
              <Icon 
                icon="carbon:chart-line" 
                class="w-12 h-12 text-gray-400 dark:text-gray-500"
              />
              <div class="text-gray-500 dark:text-gray-400 text-sm">
                {{ t('common.noData') }}
              </div>
            </div>
            <!-- 数据图表 -->
            <Line v-else
                  :data="getResponseTimeChartData(selectedMonitor)"
                  :options="responseTimeChartOptions"
            />
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>

  <!-- 故障记录详情模态框 -->
  <Teleport to="body">
    <div v-if="showDowntimeModal" 
         class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <!-- 背景遮罩 -->
      <Transition
        appear
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        enter-active-class="transition-opacity duration-300"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
        leave-active-class="transition-opacity duration-300"
      >
        <div v-show="showDowntimeModal"
             class="absolute inset-0 bg-black/60" 
             @click="closeDowntimeModal"
        ></div>
      </Transition>
      
      <!-- 弹窗内容 -->
      <Transition
        appear
        enter-from-class="opacity-0 translate-y-4 scale-95"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        enter-active-class="transition-all duration-300 transform"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-4 scale-95"
        leave-active-class="transition-all duration-300 transform"
      >
        <div v-show="showDowntimeModal"
             class="relative bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-2xl
                    shadow-xl border border-gray-200 dark:border-gray-700
                    max-h-[80vh] overflow-y-auto"
             @click.stop
        >
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
              {{ monitors?.find(m => m.id === showDowntimeModal)?.friendlyName }} - {{ t('card.downtimeRecords') }}
            </h3>
            <button @click="closeDowntimeModal"
                    class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full 
                           transition-colors duration-200">
              <Icon icon="carbon:close" 
                    class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          
          <TransitionGroup 
            tag="div"
            class="space-y-3"
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
            move-class="transition duration-200"
          >
            <div v-if="getIncidents(monitors?.find(m => m.id === showDowntimeModal))?.length" 
                 v-for="log in getIncidents(monitors?.find(m => m.id === showDowntimeModal))" 
                 :key="log.id"
                 class="p-4 bg-red-50/90 dark:bg-red-900/20 rounded-lg
                   border border-red-200/80 dark:border-red-800/80"
            >
              <div class="flex justify-between mb-2">
                <span class="text-red-600/90 dark:text-red-400/90 font-medium text-sm">{{ getIncidentReason(log) }}</span>
                <span class="text-red-600/80 dark:text-red-400/80 text-sm">{{ formatters.dateTime(log.startedAt) }}</span>
              </div>
              <div class="text-red-600/80 dark:text-red-400/80 text-sm">
                {{ t('card.duration') }}: {{ formatters.duration(log.duration) }}
              </div>
            </div>
            <div v-else
                 key="empty"
                 class="text-center text-gray-400 py-8"
            >
              {{ t('card.noRecentDowntime') }}
            </div>
          </TransitionGroup>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { format } from 'date-fns'
import { Icon } from '@iconify/vue'
import { Scatter, Line } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, TimeScale } from 'chart.js'
import { getStatusChartConfig, getResponseTimeChartData, responseTimeChartOptions } from '@/utils/chartConfig'
import { sortMonitors, normalizeStatus, isMonitorOffline, isMonitorWarning, parseTimestamp, patchResponseTimeStats } from '@/utils/monitor'
import { fetchMonitorResponseTime, isRateLimit } from '@/utils/api'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, TimeScale)

const { t, locale } = useI18n()
const props = defineProps({ monitors: Array, sort: { type: Object, default: () => ({ key: 'friendlyName', order: 'asc' }) }, error: String, refreshing: Boolean })
const emit = defineEmits(['update-monitor'])
const loading = computed(() => !props.monitors?.length || props.refreshing)

const STATUS_LABEL = { UP: 'status.online', PAUSED: 'status.paused', STARTED: 'status.preparing', DOWN: 'status.offline', LOOKS_DOWN: 'status.offline' }

const sortedMonitors = computed(() => sortMonitors(props.monitors || [], props.sort))

const statusTone = (s) => isMonitorOffline(s) ? 'red' : isMonitorWarning(s) ? 'yellow' : 'green'
const getStatusLabel = (s) => t(STATUS_LABEL[normalizeStatus(s)] || 'status.preparing')
const statusBadgeClass = (s) => ({
  red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  yellow: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
  green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
}[statusTone(s)])
const cardBorderClass = (s) => ({
  yellow: 'after:border-yellow-500/50 dark:after:border-yellow-400/50',
  red: 'after:border-red-500/50 dark:after:border-red-400/50',
  green: 'after:border-green-500/50 dark:after:border-green-400/50'
}[statusTone(s)])

const TONE_CLS = {
  green: { dot: 'bg-green-500 dark:bg-green-400', text: 'text-green-500', hoverText: 'hover:text-green-600 dark:hover:text-green-300', hoverBg: 'hover:bg-green-50 dark:hover:bg-green-900/30' },
  yellow: { dot: 'bg-yellow-500 dark:bg-yellow-400', text: 'text-yellow-500', hoverText: 'hover:text-yellow-600 dark:hover:text-yellow-300', hoverBg: 'hover:bg-yellow-50 dark:hover:bg-yellow-900/30' },
  red: { dot: 'bg-red-500 dark:bg-red-400', text: 'text-red-500', hoverText: 'hover:text-red-600 dark:hover:text-red-300', hoverBg: 'hover:bg-red-50 dark:hover:bg-red-900/30' }
}
const getStatusClasses = (s) => {
  const c = TONE_CLS[statusTone(s)]
  return { dot: c.dot, dotPing: c.dot, text: c.text, hover: { text: c.hoverText, bg: c.hoverBg } }
}

const formatters = {
  responseTime: (m) => {
    if (!m?.responseTimeStats && m?.stats?.avgResponseTime == null) return '—'
    const ms = m?.stats?.avgResponseTime
    return ms == null ? '—' : `${Math.round(ms)} ms`
  },
  uptime: (v) => `${Number(v || 0).toFixed(2)}%`,
  duration: (seconds) => {
    if (!seconds) return t('footer.seconds', { s: 0 })
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60
    if (h >= 100) return t('footer.duration', { hours: h })
    return [h && t('footer.hours', { h }), m && t('footer.minutes', { m }), (!h && !m && s) && t('footer.seconds', { s })].filter(Boolean).join('')
  },
  dateTime: (ts) => { const ms = parseTimestamp(ts); return ms ? format(new Date(ms), 'MM-dd HH:mm') : '-' }
}

const getMonitorType = (m) => t(`monitorType.${m.type}`, m.type || t('monitorType.default'))
const getErrorMessage = (code) => {
  const c = typeof code === 'object' ? code.code : code
  if (typeof c === 'string' && !/^\d+$/.test(c)) return c
  return t(`errorMessages.${c}`, t('errorMessages.default'))
}
const getIncidentReason = (inc) => getErrorMessage(inc.reason || inc.cause)

const dateRange = computed(() => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const dates = Array.from({ length: 30 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - (29 - i)); return d })
  return { startDate: dates[0], dates }
})

const getValidDays = (m) => {
  if (!m.stats?.dailyUptimes) return 0
  const create = Math.min(parseTimestamp(m.createDateTime) || 0, Date.now())
  const since = Math.max(0, Math.floor((new Date(create) - dateRange.value.startDate) / 86400000))
  return m.stats.dailyUptimes.slice(since).filter((v) => v != null && !isNaN(v)).length
}

const getDowntimeStats = (m) => {
  const list = m.stats?.incidents || []
  const days = getValidDays(m)
  if (days <= 0) return t('common.noData')
  if (list.length) return t('card.downtimeInfo', { days, count: list.length, duration: formatters.duration(m.stats?.totalDowntime) })
  return isMonitorOffline(m.status) ? t('card.currentOffline') : t('card.noDowntime')
}

const getIncidents = (m) => (m.stats?.incidents || []).slice(0, 15)
const chartOf = (m) => getStatusChartConfig(m, dateRange.value, isMobile.value)

const showDowntimeList = ref(null)
const showDowntimeModal = ref(null)
const showResponseTimeModal = ref(false)
const selectedMonitor = ref(null)
const isMobile = ref(window.innerWidth < 768)
const modalMounted = ref(false)
const rtLoading = ref(false)
const rtError = ref('')
const rtCountdown = ref(0)
let rtTimer = null, rtReqId = 0

const openUrl = (url) => {
  if (!url) return
  window.open(!/^https?:\/\//.test(url) ? `http://${url}` : url, '_blank', 'noopener,noreferrer')
}

const stopRtCountdown = () => { clearInterval(rtTimer); rtTimer = null; rtCountdown.value = 0 }
const startRtCountdown = (sec) => {
  stopRtCountdown()
  rtCountdown.value = Math.max(1, Math.ceil(sec))
  rtTimer = setInterval(() => { if (--rtCountdown.value <= 0) stopRtCountdown() }, 1000)
}

const openResponseTimeModal = async (monitor) => {
  const reqId = ++rtReqId
  selectedMonitor.value = monitor
  modalMounted.value = true
  showResponseTimeModal.value = true
  rtError.value = ''
  stopRtCountdown()
  if (monitor.responseTimeStats) return
  rtLoading.value = true
  try {
    const stats = await fetchMonitorResponseTime(monitor.id)
    if (reqId !== rtReqId) return
    if (stats) {
      const patched = patchResponseTimeStats(monitor, stats)
      emit('update-monitor', patched)
      selectedMonitor.value = patched
    } else rtError.value = t('common.noData')
  } catch (e) {
    if (reqId !== rtReqId) return
    if (isRateLimit(e)) startRtCountdown(e.retryAfter || 60)
    else rtError.value = e.message || t('error.fetchFailed')
  } finally {
    if (reqId === rtReqId) rtLoading.value = false
  }
}

const closeModal = () => { rtReqId++; showResponseTimeModal.value = false }
const onAfterLeave = () => {
  modalMounted.value = false
  stopRtCountdown()
  rtError.value = ''
  rtLoading.value = false
  selectedMonitor.value = null
}

const openDowntimeModal = (monitor) => { showDowntimeModal.value = monitor.id }
const closeDowntimeModal = () => { showDowntimeModal.value = null }

const closeOnClickOutside = (e) => {
  if (!showDowntimeList.value) return
  const inside = e.composedPath().some((el) => el.classList?.contains('downtime-list')
    || el.dataset?.monitorId === showDowntimeList.value.toString())
  if (!inside) showDowntimeList.value = null
}

const toggleDowntimeList = (id) => { showDowntimeList.value = showDowntimeList.value === id ? null : id }
const updateMobileState = () => { isMobile.value = window.innerWidth < 768 }

onMounted(() => { document.addEventListener('click', closeOnClickOutside); window.addEventListener('resize', updateMobileState) })
onUnmounted(() => { document.removeEventListener('click', closeOnClickOutside); window.removeEventListener('resize', updateMobileState); stopRtCountdown() })
</script>