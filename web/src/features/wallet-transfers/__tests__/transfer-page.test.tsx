/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { WalletTransfers } from '..'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

function renderTransfers(
  transferEnabled: boolean,
  role = 1,
  currency: 'USD' | 'CNY' = 'USD'
) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role })
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: currency,
      usdExchangeRate: currency === 'CNY' ? 7 : 1,
    },
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/api/tapcomfy/v1/wallet') {
      return {
        data: {
          success: true,
          data: {
            quota: 10750000,
            transferable_quota: 750000,
            reserve_quota: 10000000,
            quota_per_unit: 500000,
            currency,
            currency_symbol: currency === 'CNY' ? '¥' : '$',
            exchange_rate: currency === 'CNY' ? '7' : '1',
            transfer_enabled: transferEnabled,
          },
        },
      } as never
    }
    return {
      data: { success: true, data: { items: [], total: 0, page: 1 } },
    } as never
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <WalletTransfers />
    </QueryClientProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.getState().setConfig({ currency: DEFAULT_CURRENCY_CONFIG })
})

it('disables transfer when the server reports it is unavailable', async () => {
  const client = renderTransfers(false)
  expect(await screen.findByRole('status')).toHaveTextContent(
    'temporarily unavailable'
  )
  expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled()
  client.clear()
})

it('requires confirmation and sends one transfer request with an idempotency key', async () => {
  const post = vi
    .mocked(api.post)
    .mockResolvedValue({ data: { success: true, data: { id: 1 } } } as never)
  const client = renderTransfers(true)
  const user = userEvent.setup()

  await user.type(
    await screen.findByRole('textbox', { name: /Recipient username/ }),
    'bob'
  )
  await user.type(
    screen.getByRole('textbox', { name: /Amount \(USD\)/ }),
    '1.25'
  )
  await user.click(screen.getByRole('button', { name: 'Transfer' }))
  expect(post).not.toHaveBeenCalled()

  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Transfer 1.25 USD to bob?')).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: 'Transfer' }))
  await waitFor(() => expect(post).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/tapcomfy/v1/wallet/transfers',
    expect.objectContaining({
      recipient: 'bob',
      amount: '1.25',
      currency: 'USD',
      exchange_rate: '1',
      request_id: expect.any(String),
    })
  )
  client.clear()
})

it('blocks amounts above the displayed transferable balance', async () => {
  const client = renderTransfers(true)
  const user = userEvent.setup()
  expect(await screen.findByText('Transferable balance')).toBeVisible()
  await user.type(screen.getByRole('textbox', { name: /Recipient username/ }), 'bob')
  await user.type(screen.getByRole('textbox', { name: /Amount \(USD\)/ }), '1.51')
  await user.click(screen.getByRole('button', { name: 'Transfer' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Amount exceeds transferable balance')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  client.clear()
})

it('sends an administrator transfer from the selected source account', async () => {
  const post = vi
    .mocked(api.post)
    .mockResolvedValue({ data: { success: true, data: { id: 2 } } } as never)
  const client = renderTransfers(true, 10)
  const user = userEvent.setup()

  await user.type(
    await screen.findByRole('textbox', { name: /Source username/ }),
    'alice'
  )
  await user.type(
    screen.getByRole('textbox', { name: /Recipient username/ }),
    'bob'
  )
  await user.type(screen.getByRole('textbox', { name: /Amount \(USD\)/ }), '1')
  await user.click(screen.getByRole('button', { name: 'Transfer' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('From account: alice')).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: 'Transfer' }))

  await waitFor(() => expect(post).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/tapcomfy/v1/admin/wallet/transfers',
    expect.objectContaining({
      source_username: 'alice',
      recipient: 'bob',
      amount: '1',
    })
  )
  client.clear()
})

it('uses the configured CNY amount for a client transfer', async () => {
  const post = vi
    .mocked(api.post)
    .mockResolvedValue({ data: { success: true, data: { id: 3 } } } as never)
  const client = renderTransfers(true, 1, 'CNY')
  const user = userEvent.setup()
  expect(await screen.findByText('Frozen and not transferable: ¥140')).toBeVisible()

  await user.type(
    await screen.findByRole('textbox', { name: /Recipient username/ }),
    'bob'
  )
  await user.type(screen.getByRole('textbox', { name: /Amount \(CNY\)/ }), '7')
  await user.click(screen.getByRole('button', { name: 'Transfer' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Transfer 7 CNY to bob?')).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: 'Transfer' }))
  await waitFor(() => expect(post).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/tapcomfy/v1/wallet/transfers',
    expect.objectContaining({
      recipient: 'bob',
      amount: '7',
      currency: 'CNY',
      exchange_rate: '7',
    })
  )
  client.clear()
})
