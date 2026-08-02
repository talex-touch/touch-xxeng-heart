import { createApp } from 'vue'
import App from './Options.vue'
import { setupApp } from '~/logic/common-setup'
import '../styles'
import './options.css'

const app = createApp(App)
setupApp(app)
app.mount('#app')
