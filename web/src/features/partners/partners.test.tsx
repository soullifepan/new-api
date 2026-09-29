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

import { searchUsers } from '@/features/users/api'

import * as api from './api'
import { PartnersAdmin } from './index'

vi.mock('./api', () => ({
  getPartnerConfig: vi.fn(),
  grantPartner: vi.fn(),
  listPartners: vi.fn(),
  listPayouts: vi.fn(),
  listCommissions: vi.fn(),
  reviewPartner: vi.fn(),
  updatePartnerCommission: vi.fn(),
  reviewPayout: vi.fn(),
  savePartnerConfig: vi.fn(),
}))
vi.mock('@/features/users/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/users/api')>()),
  searchUsers: vi.fn(),
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
    enabled: false,
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
  expect(
    screen.queryByRole('checkbox', { name: '开放合作伙伴申请' })
  ).not.toBeInTheDocument()
  expect(screen.getByText(/不接受在线申请/)).toBeInTheDocument()
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
        enabled: false,
        commission_bps: 1250,
        alipay_daily_limit_cents: 50025,
      }),
      expect.anything()
    )
  )
})

test('partner rate supports custom percentages, failure retry, explicit zero and restoring the global rate', async () => {
  const partner: api.Partner = {
    user_id: 11,
    username: 'partner-test-user',
    status: 'approved',
    commission_bps: null,
    duration_days: null,
    channels: '视频号',
    links: '',
    plan: '',
    contact: '',
    evidence: '',
    notes: '',
    review_note: '',
    available_quota: 0,
    earned_quota: 0,
    reserved_quota: 0,
    approved_at: 1700000000,
    updated_at: 1700000000,
  }
  vi.mocked(api.listPartners).mockResolvedValue({
    items: [partner],
    total: 1,
    page: 1,
  })
  vi.mocked(api.updatePartnerCommission).mockImplementation(
    async (_, settings) => ({ ...partner, ...settings })
  )
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <PartnersAdmin />
    </QueryClientProvider>
  )
  await screen.findByText('全局 10%')
  expect(
    screen.getByRole('columnheader', { name: '用户名' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('cell', { name: 'partner-test-user' })
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看资料' }))
  const inherit = await screen.findByRole('checkbox', {
    name: '沿用全局比例（10%）',
  })
  expect(inherit).toBeChecked()
  await user.click(inherit)
  const rate = screen.getByLabelText('返佣比例（%）')
  await user.clear(rate)
  await user.type(rate, '12.5')
  vi.mocked(api.updatePartnerCommission).mockRejectedValueOnce(
    new Error('network unavailable')
  )
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  expect(await screen.findByText('保存失败，请重试。')).toBeInTheDocument()
  expect(rate).toHaveValue(12.5)
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  await waitFor(() =>
    expect(api.updatePartnerCommission).toHaveBeenLastCalledWith(11, {
      commission_bps: 1250,
      duration_days: null,
    })
  )
  await waitFor(() =>
    expect(screen.queryByText('保存失败，请重试。')).not.toBeInTheDocument()
  )
  const savedRate = screen.getByLabelText('返佣比例（%）')
  await user.clear(savedRate)
  await user.type(savedRate, '0')
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  await waitFor(() =>
    expect(api.updatePartnerCommission).toHaveBeenLastCalledWith(11, {
      commission_bps: 0,
      duration_days: null,
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存返佣设置' })).toBeEnabled()
  )
  await user.click(
    screen.getByRole('checkbox', { name: '沿用全局比例（10%）' })
  )
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  await waitFor(() =>
    expect(api.updatePartnerCommission).toHaveBeenLastCalledWith(11, {
      commission_bps: null,
      duration_days: null,
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存返佣设置' })).toBeEnabled()
  )
  await user.click(
    screen.getByRole('checkbox', { name: '沿用全局天数（365 天）' })
  )
  const days = screen.getByLabelText('返佣天数（0 表示长期）')
  await user.clear(days)
  await user.type(days, '730')
  vi.mocked(api.updatePartnerCommission).mockRejectedValueOnce(
    new Error('network unavailable')
  )
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  expect(await screen.findByText('保存失败，请重试。')).toBeInTheDocument()
  expect(days).toHaveValue(730)
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  await waitFor(() =>
    expect(api.updatePartnerCommission).toHaveBeenLastCalledWith(11, {
      commission_bps: null,
      duration_days: 730,
    })
  )
  await waitFor(() =>
    expect(screen.queryByText('保存失败，请重试。')).not.toBeInTheDocument()
  )
  const savedDays = screen.getByLabelText('返佣天数（0 表示长期）')
  await user.clear(savedDays)
  await user.type(savedDays, '0')
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  await waitFor(() =>
    expect(api.updatePartnerCommission).toHaveBeenLastCalledWith(11, {
      commission_bps: null,
      duration_days: 0,
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存返佣设置' })).toBeEnabled()
  )
  await user.click(
    screen.getByRole('checkbox', { name: '沿用全局天数（365 天）' })
  )
  await user.click(screen.getByRole('button', { name: '保存返佣设置' }))
  await waitFor(() =>
    expect(api.updatePartnerCommission).toHaveBeenLastCalledWith(11, {
      commission_bps: null,
      duration_days: null,
    })
  )
})

test('offline membership offers only active and ended filters and grants an explicitly selected account', async () => {
  vi.mocked(searchUsers).mockResolvedValue({
    success: true,
    data: {
      items: [
        {
          id: 22,
          username: 'offline-partner',
          display_name: '',
          status: 1,
          role: 1,
          group: 'default',
          quota: 0,
          used_quota: 0,
          request_count: 0,
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <PartnersAdmin />
    </QueryClientProvider>
  )
  expect(screen.getByRole('tab', { name: '伙伴管理' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '合作中' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByRole('button', { name: '已终止' })).toBeInTheDocument()
  for (const name of ['待处理', '待补充', '已通过', '已驳回', '已暂停']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
  await user.click(screen.getByRole('button', { name: '开通合作伙伴' }))
  const dialog = screen.getByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: '确认开通' })
  expect(confirm).toBeDisabled()
  await user.type(within(dialog).getByLabelText('搜索用户'), 'offline-partner')
  await user.click(within(dialog).getByRole('button', { name: '搜索' }))
  await waitFor(() =>
    expect(searchUsers).toHaveBeenCalledWith({
      keyword: 'offline-partner',
      page_size: 20,
    })
  )
  await user.click(within(dialog).getByRole('combobox'))
  await user.click(
    await screen.findByRole('option', { name: 'offline-partner（ID：22）' })
  )
  await user.type(
    within(dialog).getByLabelText('给伙伴的说明（选填，对伙伴可见）'),
    '微信确认合作'
  )
  vi.mocked(api.grantPartner).mockRejectedValueOnce(new Error('request failed'))
  await user.click(confirm)
  expect(await screen.findByRole('alert')).toHaveTextContent('开通失败')
  expect(within(dialog).getByRole('combobox')).toHaveValue(
    'offline-partner（ID：22）'
  )
  await user.click(confirm)
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(api.grantPartner).toHaveBeenLastCalledWith(
    { user_id: 22, note: '微信确认合作' },
    expect.anything()
  )
})
