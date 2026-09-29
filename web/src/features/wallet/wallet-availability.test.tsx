import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { getAffiliateCode, getPartnerAccess } from './api'
import { RechargeFormCard } from './components/recharge-form-card'
import { useAffiliate } from './hooks/use-affiliate'

vi.mock('./api', () => ({
  getAffiliateCode: vi.fn(),
  getPartnerAccess: vi.fn(),
  transferAffiliateQuota: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.getState().auth.setUser({ id: 2, username: 'partner', role: 1 })
  vi.mocked(getAffiliateCode).mockResolvedValue({
    success: true,
    data: 'test-code',
  })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
})
function queryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
test.each([
  { can_access: false, status: '' },
  { can_access: false, status: 'pending' },
  { can_access: true, status: 'suspended' },
])(
  'wallet does not request invitation codes for $status membership',
  async (access) => {
    vi.mocked(getPartnerAccess).mockResolvedValue({
      success: true,
      data: access,
    })
    const { result } = renderHook(() => useAffiliate(), {
      wrapper: queryWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.affiliateLink).toBe('')
    expect(getAffiliateCode).not.toHaveBeenCalled()
  }
)
test('active partner gets a link; switching accounts immediately clears it', async () => {
  vi.mocked(getPartnerAccess)
    .mockResolvedValueOnce({
      success: true,
      data: { can_access: true, status: 'approved' },
    })
    .mockResolvedValueOnce({
      success: true,
      data: { can_access: false, status: '' },
    })
  const { result } = renderHook(() => useAffiliate(), {
    wrapper: queryWrapper(),
  })
  await waitFor(() =>
    expect(result.current.affiliateLink).toContain('aff=test-code')
  )
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 3, username: 'ordinary', role: 1 })
  )
  expect(result.current.affiliateLink).toBe('')
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.affiliateLink).toBe('')
  expect(getAffiliateCode).toHaveBeenCalledTimes(1)
})
test('failed membership lookup never requests an invitation code', async () => {
  vi.mocked(getPartnerAccess).mockRejectedValue(new Error('unavailable'))
  const { result } = renderHook(() => useAffiliate(), {
    wrapper: queryWrapper(),
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.affiliateLink).toBe('')
  expect(getAffiliateCode).not.toHaveBeenCalled()
})
test('native Alipay counts as an available payment method', () => {
  const props = {
    topupInfo: null,
    presetAmounts: [],
    selectedPreset: null,
    onSelectPreset: vi.fn(),
    topupAmount: 1,
    onTopupAmountChange: vi.fn(),
    paymentAmount: 7,
    calculating: false,
    onPaymentMethodSelect: vi.fn(),
    paymentLoading: null,
    redemptionCode: '',
    onRedemptionCodeChange: vi.fn(),
    onRedeem: vi.fn(),
    redeeming: false,
    enableAlipayNative: true,
    onAlipayNativeSelect: vi.fn(),
  }
  const { rerender } = render(<RechargeFormCard {...props} />)
  expect(screen.getByRole('button', { name: 'Alipay' })).toBeEnabled()
  expect(
    screen.queryByText(
      'No payment methods available. Please contact administrator.'
    )
  ).not.toBeInTheDocument()
  rerender(<RechargeFormCard {...props} onAlipayNativeSelect={undefined} />)
  expect(
    screen.getByText(
      'No payment methods available. Please contact administrator.'
    )
  ).toBeInTheDocument()
})
