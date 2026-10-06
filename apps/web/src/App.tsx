import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { SignIn } from './pages/SignIn'
import { Legal } from './pages/Legal'
import { Workspace } from './pages/Workspace'
import { Dashboard } from './pages/Dashboard'
import { Rules } from './pages/Rules'
import { Connections } from './pages/Connections'
import { Activity } from './pages/Activity'
import { Billing } from './pages/Billing'
import { SettingsPage } from './pages/Settings'
import { RuleEditor } from './pages/RuleEditor'
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        {['demo', 'app'].map((path) => (
          <Route key={path} path={'/' + path} element={<Workspace demo={path === 'demo'} />}>
            <Route index element={<Dashboard />} />
            <Route path="rules" element={<Rules />} />
            <Route path="rules/new" element={<RuleEditor />} />
            <Route path="rules/:id" element={<RuleEditor />} />
            <Route path="connections" element={<Connections />} />
            <Route path="activity" element={<Activity />} />
            <Route path="billing" element={<Billing />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        ))}
        <Route
          path="*"
          element={
            <div className="auth-main">
              <div className="auth-card">
                <h1>Une page égarée.</h1>
                <Link className="button button-primary" to="/">
                  Retour à l’accueil
                </Link>
              </div>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
