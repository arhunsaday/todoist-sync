// Public information only. Complete and approve this file before accepting live payments.
export const legal = {
  approved: false,
  version: '2026-10-07',
  publisher: '',
  status: '',
  address: '',
  registration: '',
  vat: '',
  contact: '',
  director: '',
  country: '',
  audience: '',
  taxNotice: '',
  mediatorName: '',
  mediatorAddress: '',
  mediatorUrl: '',
  transfersNotice: '',
  hostingNotice:
    'Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA ; téléphone : +1 650 319 8930',
  withdrawalNotice: '',
  guaranteeNotice: '',
  accountingRetentionNotice: '',
  backupRetentionDays: 30,
}
export function legalReady() {
  return (
    legal.approved &&
    [
      legal.publisher,
      legal.status,
      legal.address,
      legal.contact,
      legal.director,
      legal.country,
      legal.audience,
      legal.taxNotice,
      legal.transfersNotice,
      legal.hostingNotice,
      legal.accountingRetentionNotice,
      ...(legal.audience !== 'professionals'
        ? [
            legal.mediatorName,
            legal.mediatorAddress,
            legal.mediatorUrl,
            legal.withdrawalNotice,
            legal.guaranteeNotice,
          ]
        : []),
    ].every((value) => value.trim().length > 0)
  )
}
