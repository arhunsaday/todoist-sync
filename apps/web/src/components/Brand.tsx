import { Link } from 'react-router-dom'
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Accord, accueil">
      <span className="brand-symbol" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      accord<span className="brand-dot">.</span>
    </Link>
  )
}
