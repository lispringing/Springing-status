import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import './style.css'
import messages from './locales'

// 获取浏览器语言或从 localStorage 读取
const getSavedLocale = () => {
  const saved = localStorage.getItem('locale')
  if (saved && (saved === 'zh-CN' || saved === 'en-US')) {
    return saved
  }
  // 如果没有保存的语言，使用浏览器语言
  const browserLang = navigator.language || navigator.userLanguage
  return browserLang.startsWith('zh') ? 'zh-CN' : 'en-US'
}

const i18n = createI18n({
  legacy: false,
  locale: getSavedLocale(),
  fallbackLocale: 'en-US',
  messages
})

const app = createApp(App)
app.use(i18n)
app.mount('#app')
