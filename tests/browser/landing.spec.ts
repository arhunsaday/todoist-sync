import { test, expect } from '@playwright/test'
test('opens demo and creates a rule without live writes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /enfin d’accord/ })).toBeVisible()
  await page.getByRole('link', { name: 'Voir la démo', exact: true }).click()
  await expect(page.getByText('Démonstration — données fictives', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Créer une règle', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nouvelle règle', exact: true })).toBeVisible()
  await page.getByLabel('Nom de la règle').fill('Mes tâches personnelles')
  await page.getByLabel('Projet source').selectOption('personal')
  await page.getByLabel('Calendrier de destination').selectOption('personal-cal')
  await page.getByRole('button', { name: 'Enregistrer la règle' }).click()
  await expect(page.getByText('Mes tâches personnelles', { exact: true })).toBeVisible()
})
test('has no horizontal overflow', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
