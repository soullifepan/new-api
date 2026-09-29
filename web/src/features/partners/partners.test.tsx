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
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import * as api from './api'
import { PartnersAdmin } from './index'

vi.mock('./api', () => ({
  getPartnerConfig: vi.fn(),
  listPartners: vi.fn(),
  listPayouts: vi.fn(),
  listCommissions: vi.fn(),
  reviewPartner: vi.fn(),
  reviewPayout: vi.fn(),
  savePartnerConfig: vi.fn(),
}))
let client: QueryClient
const payout: api.Payout = {
  id: 7,
  user_id: 11,
  kind: 'alipay',
  amount: '33.54',
  currency: 'CNY',
  status: 'pending',
  recipient_name: '测试收款人',
  account: 'test-payee',
  bank_name: '',
  company_code: '',
  debit_quota: 100,
  quota: 0,
  exchange_rate: '7',
  credit_price: '2',
  created_at: 1700000000,
  completed_at: 0,
  reviewed_by: 0,
  review_note: '',
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.mocked(api.getPartnerConfig).mockResolvedValue({
    enabled: true,
    balance_price_source: 'alipay_native',
    commission_bps: 1000,
    duration_days: 365,
    first_topup_only: false,
    min_payout_cents: 1,
    alipay_daily_limit_cents: 50000,
    bank_single_limit_cents: 500000,
  })
  vi.mocked(api.listPartners).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
  })
  vi.mocked(api.listPayouts).mockResolvedValue({
    items: [payout],
    total: 1,
    page: 1,
  })
  vi.mocked(api.reviewPayout).mockResolvedValue({ success: true })
})
afterEach(() => {
  cleanup()
  client.clear()
})

async function openPayout() {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <PartnersAdmin />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('tab', { name: '提现与划转' }))
  await user.click(await screen.findByRole('button', { name: '查看申请' }))
  return user
}

test('manual payout requires explicit confirmation and retains a failed request for retry', async () => {
  const user = await openPayout()
  expect(api.reviewPayout).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '标记已打款' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('33.54 CNY')).toBeInTheDocument()
  expect(
    within(dialog).getByText(/测试收款人 · test-payee/)
  ).toBeInTheDocument()
  expect(api.reviewPayout).not.toHaveBeenCalled()
  vi.mocked(api.reviewPayout).mockRejectedValueOnce(
    new Error('network unavailable')
  )
  await user.click(within(dialog).getByRole('button', { name: '确认已打款' }))
  await waitFor(() =>
    expect(api.reviewPayout).toHaveBeenCalledWith(7, 'paid', '')
  )
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: '确认已打款' })
    ).toBeEnabled()
  )
  await user.click(within(dialog).getByRole('button', { name: '确认已打款' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(api.reviewPayout).toHaveBeenCalledTimes(2)
})

test('rejection requires a reason and submits it to the settlement endpoint', async () => {
  const user = await openPayout()
  await user.click(screen.getByRole('button', { name: '驳回' }))
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: '确认驳回' })
  expect(confirm).toBeDisabled()
  await user.type(within(dialog).getByRole('textbox'), '收款账号需要修改')
  await user.click(confirm)
  await waitFor(() =>
    expect(api.reviewPayout).toHaveBeenCalledWith(
      7,
      'rejected',
      '收款账号需要修改'
    )
  )
})

test('administrator enters percentages and yuan while the API receives exact basis points and cents', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <PartnersAdmin />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('tab', { name: '返佣规则' }))
  const rate = await screen.findByLabelText('返佣比例（%）')
  expect(screen.queryByLabelText('仅客户首次充值返佣')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    screen.getByText(/佣金转余额按 TapComfy 当前充值价格兑换/)
  ).toBeInTheDocument()
  expect(screen.getByText(/客户每次充值均按设定比例返佣/)).toBeInTheDocument()
  await user.clear(rate)
  await user.type(rate, '12.5')
  const limit = screen.getByLabelText('支付宝每日限额（人民币元，0 不限）')
  await user.clear(limit)
  await user.type(limit, '500.25')
  await user.click(screen.getByRole('button', { name: '保存规则' }))
  await waitFor(() =>
    expect(api.savePartnerConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        commission_bps: 1250,
        alipay_daily_limit_cents: 50025,
      }),
      expect.anything()
    )
  )
})
