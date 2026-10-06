import { useEffect, useState } from 'react'
import { api } from '../lib/api'
export function MonthlyPrice() {
  const [price, setPrice] = useState({ amount: 6, currency: 'EUR' })
  useEffect(() => {
    api<{ price: { amount: string; currency: string } }>('/config')
      .then((c) => {
        if (Number.isFinite(Number(c.price.amount)) && /^[A-Z]{3}$/.test(c.price.currency))
          setPrice({ amount: Number(c.price.amount), currency: c.price.currency })
      })
      .catch(() => {})
  }, [])
  return (
    <div className="price">
      {new Intl.NumberFormat('fr', {
        style: 'currency',
        currency: price.currency,
        maximumFractionDigits: price.amount % 1 ? 2 : 0,
      }).format(price.amount)}{' '}
      <span>/ mois</span>
    </div>
  )
}
