import React from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Home from './routes/Home'
import Canvas from './routes/Canvas'
import Assistant from './routes/Assistant'
import UpdateChecker from './components/UpdateChecker'

const base = import.meta.env.BASE_URL || '/'
const isDesktop = base.startsWith('./')
const basename = isDesktop ? undefined : base.replace(/\/$/, '')

export default function App() {
  const Router = isDesktop ? HashRouter : BrowserRouter
  return (
    <Router basename={basename}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/canvas/:id?" element={<Canvas />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdateChecker />
    </Router>
  )
}
