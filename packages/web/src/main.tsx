import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { Presenter } from './present/Presenter.js'
import './styles/base.css'
import './styles/app.css'
import './styles/cell.css'
import './styles/present.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

// The presenter is a second window on the same origin, not a route of the app.
const isPresenter = window.location.hash.replace(/^#/, '') === 'presenter'

createRoot(root).render(<StrictMode>{isPresenter ? <Presenter /> : <App />}</StrictMode>)
