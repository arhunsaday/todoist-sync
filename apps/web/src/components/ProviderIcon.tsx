import type { Provider } from '@accord/domain'
export const providerNames = { todoist: 'Todoist', google: 'Google Agenda', notion: 'Notion' }
export function ProviderIcon({ provider, size = 36 }: { provider: Provider; size?: number }) {
  return (
    <span
      className={`provider-icon provider-${provider}`}
      style={{ width: size, height: size }}
      aria-label={providerNames[provider]}
    >
      {provider === 'todoist' ? (
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="m8 11 5 3 11-6M8 16l5 3 11-6M8 21l5 3 11-6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : provider === 'notion' ? (
        <span>N</span>
      ) : (
        <svg viewBox="0 0 32 32">
          <path fill="#4285f4" d="M5 7h22v22H5z" />
          <path fill="#fff" d="M10 12h12v12H10z" />
          <path fill="#34a853" d="M22 12h5v12h-5z" />
          <path fill="#fbbc04" d="M10 24h12v5H10z" />
          <path fill="#ea4335" d="M22 24h5l-5 5z" />
          <path fill="#1967d2" d="M5 7h5v5H5z" />
          <text x="16" y="21" textAnchor="middle" fill="#4285f4" fontSize="9" fontWeight="700">
            31
          </text>
        </svg>
      )}
    </span>
  )
}
