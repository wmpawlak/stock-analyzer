import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { migrateLocalStorageOnce } from './utils/persistentStorage.js'
import './index.css'

await migrateLocalStorageOnce()

const [{ store }, { default: App }] = await Promise.all([
  import('./store'),
  import('./App.jsx'),
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
)
